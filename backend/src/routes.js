import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { User,Category,Product,Batch,TraceEvent,Alert } from './models/index.js';
import { authenticate,authorize } from './middleware/auth.js';
import { addEvent,verifyBatch } from './services/chain.js';

const r=Router();
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const safeUser=u=>({id:u._id,fullName:u.fullName,email:u.email,role:u.role});
const roles={admin:['admin'],product:['admin','producer','processor'],batch:['admin','producer'],processing:['admin','processor'],transport:['admin','transporter'],establishment:['admin','establishment']};

r.post('/auth/register',asyncRoute(async(req,res)=>{
 const {fullName,email,password,role='producer'}=req.body;
 if(!fullName||!email||!password||password.length<8) return res.status(400).json({message:'Completa nombre, correo y contraseña de al menos 8 caracteres.'});
 if(await User.exists({email:email.toLowerCase()})) return res.status(409).json({message:'Ese correo ya está registrado.'});
 const user=await User.create({fullName,email,passwordHash:await bcrypt.hash(password,12),role:['producer','processor','transporter','establishment'].includes(role)?role:'producer'});
 res.status(201).json({user:safeUser(user),message:'Cuenta creada. Ya puedes iniciar sesión.'});
}));
r.post('/auth/login',asyncRoute(async(req,res)=>{
 const {email,password}=req.body; const user=await User.findOne({email:(email||'').toLowerCase()});
 if(!user||!user.isActive||!await bcrypt.compare(password||'',user.passwordHash)) return res.status(401).json({message:'Correo o contraseña incorrectos.'});
 const token=jwt.sign({sub:user._id,role:user.role},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
 res.json({token,user:safeUser(user)});
}));
r.get('/auth/me',authenticate,(req,res)=>res.json({user:safeUser(req.user)}));

r.get('/categories',authenticate,asyncRoute(async(req,res)=>res.json(await Category.find().sort({name:1}))));
r.post('/categories',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.status(201).json(await Category.create(req.body))));
r.put('/categories/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.json(await Category.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true}))));
r.delete('/categories/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>{await Category.findByIdAndDelete(req.params.id);res.json({message:'Categoría eliminada.'});}));

r.get('/products',authenticate,asyncRoute(async(req,res)=>res.json(await Product.find({isActive:true}).populate('categoryId','name').sort({createdAt:-1}))));
r.post('/products',authenticate,authorize(...roles.product),asyncRoute(async(req,res)=>res.status(201).json(await Product.create({...req.body,createdById:req.user._id}))));
r.put('/products/:id',authenticate,authorize(...roles.product),asyncRoute(async(req,res)=>res.json(await Product.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true}))));
r.delete('/products/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>{await Product.findByIdAndUpdate(req.params.id,{isActive:false});res.json({message:'Producto desactivado.'});}));

r.get('/batches',authenticate,asyncRoute(async(req,res)=>{
 const filter={}; if(req.query.status)filter.status=req.query.status;
 res.json(await Batch.find(filter).populate('productId','name unit').populate('producerId','fullName').sort({createdAt:-1}));
}));
r.post('/batches',authenticate,authorize(...roles.batch),asyncRoute(async(req,res)=>{
 const {productId,quantity,batchCode,origin,productionDate,notes}=req.body;
 if(!productId||!quantity||!batchCode||!origin) return res.status(400).json({message:'Producto, cantidad, código y origen son obligatorios.'});
 const batch=await Batch.create({productId,quantity,batchCode,origin,productionDate,notes,producerId:req.user._id});
 await addEvent({batch,stage:'production',user:req.user,location:origin,details:{quantity,productionDate,notes}});
 res.status(201).json(batch);
}));
r.get('/batches/:id',authenticate,asyncRoute(async(req,res)=>{
 const batch=await Batch.findById(req.params.id).populate('productId').populate('producerId','fullName');
 if(!batch)return res.status(404).json({message:'Lote no encontrado.'});
 const events=await TraceEvent.find({batchId:batch._id}).populate('registeredById','fullName role').sort({timestamp:1});
 res.json({batch,events});
}));
async function stage(req,res,stage,status) {
 const batch=await Batch.findById(req.params.id); if(!batch)return res.status(404).json({message:'Lote no encontrado.'});
 const body=req.body||{}; if(!body.location)return res.status(400).json({message:'La ubicación es obligatoria.'});
 const event=await addEvent({batch,stage,user:req.user,location:body.location,details:body.details||body,temperature:body.temperature===undefined?undefined:Number(body.temperature),humidity:body.humidity===undefined?undefined:Number(body.humidity)});
 batch.status=status; await batch.save(); res.status(201).json({batch,event});
}
r.post('/batches/:id/processing',authenticate,authorize(...roles.processing),asyncRoute((req,res)=>stage(req,res,'processing','processing')));
r.post('/batches/:id/transport',authenticate,authorize(...roles.transport),asyncRoute((req,res)=>stage(req,res,'transport','in_transit')));
r.post('/batches/:id/reception',authenticate,authorize(...roles.establishment),asyncRoute((req,res)=>stage(req,res,'reception','received')));
r.post('/batches/:id/storage',authenticate,authorize(...roles.establishment),asyncRoute((req,res)=>stage(req,res,'storage','stored')));
r.get('/batches/:id/verify',authenticate,asyncRoute(async(req,res)=>{
 const result=await verifyBatch(req.params.id);
 if(!result.valid) await Alert.create({batchId:req.params.id,eventId:result.events.at(-1)?._id,type:'integrity_violation',message:'La cadena de evidencias presenta una alteración.'}).catch(()=>{});
 res.json({valid:result.valid,eventCount:result.eventCount,lastHash:result.lastHash});
}));
r.get('/batches/:id/qr',authenticate,asyncRoute(async(req,res)=>{
 const b=await Batch.findById(req.params.id); if(!b)return res.status(404).json({message:'Lote no encontrado.'});
 const base=process.env.PUBLIC_APP_URL||process.env.CLIENT_URL||'http://localhost:5173';
 const url=`${base}/trace/${encodeURIComponent(b.batchCode)}`;
 const data=await QRCode.toDataURL(url,{width:420,margin:2});
 b.qrCodeUrl=data; await b.save(); res.json({qrCodeUrl:data,url,batchCode:b.batchCode});
}));
r.get('/public/trace/:batchCode',asyncRoute(async(req,res)=>{
 const code = decodeURIComponent(req.params.batchCode).trim();

const batch = await Batch.findOne({
  batchCode: { $regex: `^${code}$`, $options: 'i' }
}).populate('productId','name type unit categoryId')
  .populate('producerId','fullName');
 if(!batch)return res.status(404).json({message:'No encontramos ese lote.'});
 const events=await TraceEvent.find({batchId:batch._id}).sort({timestamp:1}).select('-registeredById');
 const integrity=await verifyBatch(batch._id);
 res.json({batch,events,integrity:{valid:integrity.valid,eventCount:integrity.eventCount}});
}));
r.get('/alerts',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.json(await Alert.find().populate('batchId','batchCode').sort({createdAt:-1}))));
r.patch('/alerts/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.json(await Alert.findByIdAndUpdate(req.params.id,{isResolved:true},{new:true}))));
r.get('/users',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.json((await User.find().select('-passwordHash').sort({createdAt:-1})).map(safeUser))));
r.patch('/users/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>res.json(safeUser(await User.findByIdAndUpdate(req.params.id,{role:req.body.role,isActive:req.body.isActive},{new:true})))));
r.delete('/users/:id',authenticate,authorize('admin'),asyncRoute(async(req,res)=>{if(String(req.user._id)===req.params.id)return res.status(400).json({message:'No puedes eliminar tu propia cuenta.'});await User.findByIdAndDelete(req.params.id);res.json({message:'Usuario eliminado.'});}));
r.get('/dashboard',authenticate,asyncRoute(async(req,res)=>{
 const [users,products,batches,alerts,stored]=await Promise.all([User.countDocuments(),Product.countDocuments({isActive:true}),Batch.countDocuments(),Alert.countDocuments({isResolved:false}),Batch.countDocuments({status:'stored'})]);
 res.json({users,products,batches,alerts,stored});
}));
export default r;
