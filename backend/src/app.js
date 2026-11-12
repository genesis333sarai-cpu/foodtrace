import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { connectDB } from './config/db.js';
import routes from './routes.js';
import { Category } from './models/index.js';

dns.setServers(['8.8.8.8', '1.1.1.1']);


const app=express();
app.set('trust proxy', 1);

app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://172.17.20.210:5173',
  'http://172.17.20.210:5174',
  'http://192.168.8.33:5173',
  'http://192.168.0.101:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin === process.env.CLIENT_URL
        || /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error('Origen no permitido por CORS'));
  }
}));
app.use(express.json({limit:'2mb'}));
app.use(morgan('dev'));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
app.get('/api/health',(req,res)=>res.json({status:'ok',service:'FoodTrace API'}));
app.use('/api',routes);
const swaggerSpec=swaggerJsdoc({definition:{openapi:'3.0.0',info:{title:'FoodTrace API',version:'1.0.0',description:'API REST de trazabilidad alimentaria'},servers:[{url:'http://localhost:5000/api'}]},apis:[]});
app.use('/api-docs',swaggerUi.serve,swaggerUi.setup(swaggerSpec));
app.use((err,req,res,next)=>{
 console.error(err);
 if(err.code===11000)return res.status(409).json({message:'Ya existe un registro con ese identificador.'});
 res.status(err.status||500).json({message:err.message||'Error interno del servidor.'});
});
const port=process.env.PORT||5000;
connectDB().then(async()=>{
 for(const c of [{name:'Frutas y verduras',description:'Productos agrícolas frescos'},{name:'Productos lácteos',description:'Leche y derivados'},{name:'Alimentos procesados',description:'Alimentos transformados'}])
  await Category.updateOne({name:c.name},{$setOnInsert:c},{upsert:true});
 app.listen(port, '0.0.0.0', () => {
  console.log(`FoodTrace API: http://localhost:${port}`);
  console.log(`Acceso desde la red: http://172.17.20.210:${port}`);
});
}).catch(e=>{console.error('No se pudo iniciar:',e.message);process.exit(1);});
