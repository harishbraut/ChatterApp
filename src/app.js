import express from "express";
import http from "http";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import cors from "cors";
import Message from "./schemas/message.schema.js";
import Room from "./schemas/room.schema.js";
import RoomJoin from "./schemas/roomJoin.schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "ui")));
app.use("/styles", express.static(path.join(__dirname, "styles")));

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminAuth(req, res, next) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Admin credentials are not configured" });
  }

  const authHeader = req.headers.authorization || "";
  const [scheme, encoded] = authHeader.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const [username, password] = Buffer.from(encoded, "base64")
    .toString("utf-8")
    .split(":");

  const validUsername = timingSafeStringEqual(username || "", process.env.ADMIN_USERNAME);
  const validPassword = timingSafeStringEqual(password || "", process.env.ADMIN_PASSWORD);

  if (!validUsername || !validPassword) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  next();
}

app.get("/admin/messages", requireAdminAuth, async (req, res) => {
  try {
    const messages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(2000)
      .lean();
    res.json(messages);
  } catch (err) {
    console.log("Failed to fetch messages for admin:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.get("/admin/joins", requireAdminAuth, async (req, res) => {
  try {
    const joins = await RoomJoin.find()
      .sort({ joinedAt: -1 })
      .limit(2000)
      .lean();
    res.json(joins);
  } catch (err) {
    console.log("Failed to fetch room joins for admin:", err);
    res.status(500).json({ error: "Failed to fetch room joins" });
  }
});

export const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Separate namespace for admin observers watching the live feed - kept
// isolated from the regular chat namespace above so a chat client can never
// accidentally receive admin traffic (or vice versa).
const adminNamespace = io.of("/admin");

adminNamespace.use((socket, next) => {
  const { username, password } = socket.handshake.auth || {};
  if (
    process.env.ADMIN_USERNAME &&
    process.env.ADMIN_PASSWORD &&
    timingSafeStringEqual(username || "", process.env.ADMIN_USERNAME) &&
    timingSafeStringEqual(password || "", process.env.ADMIN_PASSWORD)
  ) {
    return next();
  }
  next(new Error("Unauthorized"));
});

adminNamespace.on("connection", (socket) => {
  socket.join("observers");
});

const connectedUsers = {}; // socket.id -> { userName, room }

io.on("connection", (socket) => {
  console.log("Connection made.");

  socket.on("newUser", ({ userName, room }) => {
    console.log(`New user: ${userName} joined room: ${room}`);

    const usersInRoom = Object.values(connectedUsers)
      .filter((u) => u.room === room)
      .map((u) => u.userName);
    socket.emit("currentUsers", usersInRoom);

    connectedUsers[socket.id] = { userName, room };
    socket.join(room);
    socket.to(room).emit("userJoined", userName);

    adminNamespace
      .to("observers")
      .emit("adminUserJoined", { room, userName, joinedAt: new Date() });

    Room.findOneAndUpdate(
      { name: room },
      { $set: { lastActiveAt: new Date() }, $setOnInsert: { name: room } },
      { upsert: true }
    ).catch((err) => console.log("Failed to record room:", err));

    RoomJoin.create({ room, userName }).catch((err) =>
      console.log("Failed to record room join:", err)
    );
  });

  socket.on("chatMessage", async (data) => {
    const user = connectedUsers[socket.id];
    if (!user) return;
    console.log("Received message:", data.message);
    console.log("User is:", data.userName);
    // Broadcast the message to everyone else in the same room
    socket.to(user.room).emit("broadcastedMessage", data);

    adminNamespace.to("observers").emit("adminMessage", {
      room: user.room,
      userName: user.userName,
      message: data.message,
      timestamp: new Date(),
    });

    try {
      await Message.create({
        room: user.room,
        userName: user.userName,
        message: data.message,
      });
    } catch (err) {
      console.log("Failed to save message:", err);
    }
  });

  socket.on("typing", function (userName) {
    const user = connectedUsers[socket.id];
    if (!user) return;
    socket.to(user.room).emit("displayTyping", userName);
  });

  socket.on("stopTyping", function () {
    const user = connectedUsers[socket.id];
    if (!user) return;
    socket.to(user.room).emit("removeTyping");
  });

  socket.on("disconnect", () => {
    console.log("Connection disconnected.");
    const user = connectedUsers[socket.id];
    delete connectedUsers[socket.id];
    if (user) {
      socket.to(user.room).emit("userLeft", user.userName);
      adminNamespace
        .to("observers")
        .emit("adminUserLeft", { room: user.room, userName: user.userName });
    }
  });
});
