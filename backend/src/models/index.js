import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const userSchema = new Schema({
  fullName:{type:String,required:true,trim:true},
  email:{type:String,required:true,unique:true,lowercase:true,trim:true,index:true},
  passwordHash:{type:String,required:true},
  role:{type:String,enum:['admin','producer','processor','transporter','establishment'],default:'producer'},
  phone:String, nationalId:String, isActive:{type:Boolean,default:true}
},{timestamps:true});

const categorySchema = new Schema({name:{type:String,required:true,unique:true},description:String},{timestamps:true});
const productSchema = new Schema({
  name:{type:String,required:true}, categoryId:{type:Schema.Types.ObjectId,ref:'Category',required:true},
  type:{type:String,enum:['raw_food','input','processed'],default:'raw_food'},
  unit:{type:String,default:'kg'}, description:String, createdById:{type:Schema.Types.ObjectId,ref:'User'},
  isActive:{type:Boolean,default:true}
},{timestamps:true});
const batchSchema = new Schema({
  batchCode:{type:String,required:true,unique:true,index:true}, productId:{type:Schema.Types.ObjectId,ref:'Product',required:true},
  producerId:{type:Schema.Types.ObjectId,ref:'User',required:true}, quantity:{type:Number,required:true,min:0.001},
  status:{type:String,enum:['produced','processing','in_transit','received','stored'],default:'produced'},
  qrCodeUrl:String,currentHash:String, productionDate:Date, origin:String, notes:String
},{timestamps:true});
const eventSchema = new Schema({
  batchId:{type:Schema.Types.ObjectId,ref:'Batch',required:true,index:true},
  stage:{type:String,enum:['production','processing','transport','reception','storage'],required:true},
  registeredById:{type:Schema.Types.ObjectId,ref:'User',required:true},
  location:{type:String,required:true},timestamp:{type:Date,default:Date.now},
  details:{type:Schema.Types.Mixed,default:{}},temperature:Number,humidity:Number,
  prevHash:{type:String,required:true},hash:{type:String,required:true}
},{timestamps:true});
eventSchema.index({batchId:1,timestamp:1});
const alertSchema = new Schema({
  batchId:{type:Schema.Types.ObjectId,ref:'Batch',required:true},
  eventId:{type:Schema.Types.ObjectId,ref:'TraceEvent',required:true},
  type:{type:String,enum:['temperature_out_of_range','integrity_violation'],required:true},
  message:{type:String,required:true},isResolved:{type:Boolean,default:false}
},{timestamps:true});
export const User=model('User',userSchema);
export const Category=model('Category',categorySchema);
export const Product=model('Product',productSchema);
export const Batch=model('Batch',batchSchema);
export const TraceEvent=model('TraceEvent',eventSchema);
export const Alert=model('Alert',alertSchema);
