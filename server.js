import dotenv from "dotenv";
dotenv.config();
import { connectToDatabase } from "./src/configs/db.config.js";
import { server } from "./src/app.js";

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await connectToDatabase();
});
