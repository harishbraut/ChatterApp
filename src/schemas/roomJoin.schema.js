import mongoose from "mongoose";

const roomJoinSchema = new mongoose.Schema({
    room: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    joinedAt: { type: Date, default: Date.now }
});

const RoomJoin = mongoose.model("RoomJoin", roomJoinSchema);
export default RoomJoin;
