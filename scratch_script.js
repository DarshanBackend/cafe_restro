import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.DB_URL).then(async () => {
  const collections = ['stays', 'hotels', 'cafes', 'restros', 'halls'];
  
  for (const collName of collections) {
    const result = await mongoose.connection.collection(collName).updateMany({}, { $unset: { rating: "" } });
    console.log('Unset rating in', collName, 'count:', result.modifiedCount);
  }
  
  mongoose.disconnect();
}).catch(console.error);
