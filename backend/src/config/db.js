
import mongoose from 'mongoose';

export async function connectDB() {
  if (!process.env.MONGO_URI) {
    throw new Error('Falta MONGO_URI en backend/.env');
  }

  await mongoose.connect(process.env.MONGO_URI);

  console.log('MongoDB conectado:', mongoose.connection.name);
}
