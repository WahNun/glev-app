import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entriesRouter from "./entries";
import insightsRouter from "./insights";
import recommendationsRouter from "./recommendations";
import authRouter from "./auth";
import cgmRouter from "./cgm";
import foodRouter from "./food";
import parseFoodRouter from "./parseFood";
import sheetsRouter from "./sheets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(entriesRouter);
router.use(insightsRouter);
router.use(recommendationsRouter);
router.use(cgmRouter);
router.use(foodRouter);
router.use(parseFoodRouter);
router.use(sheetsRouter);

export default router;
