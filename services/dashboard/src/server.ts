import http from "node:http";
import path from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { openDatabase } from "./db/database.js";
import { createRouter } from "./routes.js";
import { createDispatchScheduler } from "./scheduler.js";
import { createAuth } from "./auth.js";

const port = Number(process.env.DASHBOARD_PORT ?? 3000);
const databasePath = process.env.DATABASE_PATH ?? path.resolve("data/telemetry.sqlite");
const publicDir = path.resolve("src/public");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const store = openDatabase(databasePath);
store.resetRunningTasks();
const scheduler = createDispatchScheduler(store, io);
const auth = createAuth(path.dirname(databasePath));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auth.routes);
app.use(auth.requireAuth);
app.use(express.static(publicDir));
app.use(createRouter(store, io, scheduler));

io.use((socket, next) => {
  if (auth.verifyCookie(socket.request.headers.cookie)) {
    next();
    return;
  }
  next(new Error("Authentication required"));
});

io.on("connection", (socket) => {
  socket.emit("snapshot", {
    tasks: store.listTasks(),
    stats: store.stats(),
    logs: store.listExecutionLogs(undefined, 200)
  });
});

server.listen(port, () => {
  scheduler.restorePendingDispatches();
  console.log(`dashboard-service listening on :${port}`);
});
