import { Router } from "express";
import authRouter from "./auth";
import messagesRouter from "./messages";
import adminRouter from "./admin";

const router = Router();

router.use("/", authRouter);
router.use("/messages", messagesRouter);
router.use("/admin", adminRouter);

export default router;
