import { model, models, Schema, Types } from "mongoose";

const UserSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254
  },
  passwordHash: {
    type: String,
    required: true,
    select: false
  }
}, { timestamps: true });

const SessionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    select: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  }
}, { timestamps: true });

const PracticeProgressSchema = new Schema({
  flashcardId: { type: String, required: true },
  confidence: { type: Number, required: true, min: 1, max: 5 },
  covered: { type: Boolean, required: true, default: true },
  lastReviewedAt: { type: Date, required: true },
  reviewCount: { type: Number, required: true, min: 1, default: 1 }
}, { _id: false });

const KitSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  kit: {
    type: Schema.Types.Mixed,
    required: true
  },
  practiceProgress: {
    type: [PracticeProgressSchema],
    default: []
  }
}, { timestamps: true });

KitSchema.index({ userId: 1, updatedAt: -1 });

export const UserModel = models.User ?? model("User", UserSchema);
export const SessionModel = models.Session ?? model("Session", SessionSchema);
export const KitModel = models.Kit ?? model("Kit", KitSchema);

export type DatabaseId = Types.ObjectId;
