import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { User } from '../models/index.js';
const rl=readline.createInterface({input,output});
try{
 await connectDB();
 const fullName=await rl.question('Nombre del administrador: ');
 const email=(await rl.question('Correo: ')).trim().toLowerCase();
 const password=await rl.question('Contraseña (mínimo 8 caracteres): ');
 if(password.length<8)throw new Error('La contraseña debe tener al menos 8 caracteres.');
 const passwordHash=await bcrypt.hash(password,12);
 await User.findOneAndUpdate({email},{fullName,email,passwordHash,role:'admin',isActive:true},{upsert:true,new:true});
 console.log('Administrador creado/actualizado. Ya puedes iniciar sesión.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{rl.close();process.exit();}
