import mongoose from "mongoose";

const WalletTransactionSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['credit', 'debit'], 
    required: true 
  },
  description: { 
    type: String 
  },
  transactionId: { 
    type: String 
  },
  status: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'completed' 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

const WalletTransactionModel = mongoose.model("WalletTransaction", WalletTransactionSchema);

export default WalletTransactionModel;
