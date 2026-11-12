import crypto from 'crypto';
import { TraceEvent, Batch, Alert } from '../models/index.js';

export async function addEvent({batch,stage,user,location,details={},temperature,humidity}) {
  const previous=await TraceEvent.find({batchId:batch._id}).sort({timestamp:-1,_id:-1}).limit(1);
  const prevHash=previous[0]?.hash || '0'.repeat(64);
  const timestamp=new Date();
  const payload=JSON.stringify({batchId:String(batch._id),stage,timestamp:timestamp.toISOString(),location,details,temperature:temperature ?? null,humidity:humidity ?? null,prevHash});
  const hash=crypto.createHash('sha256').update(payload).digest('hex');
  const event=await TraceEvent.create({batchId:batch._id,stage,registeredById:user._id,location,timestamp,details,temperature,humidity,prevHash,hash});
  batch.currentHash=hash; await batch.save();
  if(typeof temperature==='number' && temperature > 5 && (stage==='transport' || stage==='storage')) {
    await Alert.create({batchId:batch._id,eventId:event._id,type:'temperature_out_of_range',message:`Temperatura registrada de ${temperature} °C. Revisar el rango permitido para este producto.`});
  }
  return event;
}

export async function verifyBatch(batchId) {
  const events=await TraceEvent.find({batchId}).sort({timestamp:1,_id:1});
  let previous='0'.repeat(64), valid=true;
  for(const e of events) {
    const payload=JSON.stringify({batchId:String(e.batchId),stage:e.stage,timestamp:new Date(e.timestamp).toISOString(),location:e.location,details:e.details,temperature:e.temperature ?? null,humidity:e.humidity ?? null,prevHash:previous});
    const calculated=crypto.createHash('sha256').update(payload).digest('hex');
    if(e.prevHash!==previous || e.hash!==calculated) valid=false;
    previous=e.hash;
  }
  return {valid,eventCount:events.length,lastHash:previous,events};
}
