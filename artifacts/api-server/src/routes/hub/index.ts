import { Router } from "express";
import messagesRouter from "./messages";
import adminRouter from "./admin";

const router = Router();

router.use("/messages", messagesRouter);
router.use("/admin", adminRouter);

export default router;
