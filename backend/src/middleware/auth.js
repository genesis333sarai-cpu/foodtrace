import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export async function authenticate(req,res,next) {
  try {
    const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!token) return res.status(401).json({message:'Inicia sesión para continuar.'});
    const payload=jwt.verify(token,process.env.JWT_SECRET);
    const user=await User.findById(payload.sub).select('-passwordHash');
    if(!user || !user.isActive) return res.status(401).json({message:'Sesión no válida.'});
    req.user=user; next();
  } catch { return res.status(401).json({message:'Token inválido o vencido.'}); }
}
export const authorize=(...roles)=>(req,res,next)=>{
  if(!req.user || !roles.includes(req.user.role)) return res.status(403).json({message:'No tienes permisos para esta operación.'});
  next();
};
