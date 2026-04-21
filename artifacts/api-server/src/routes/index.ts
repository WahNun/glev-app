import { Router, type IRouter } from "express";
import healthRouter from "./health";
import entriesRouter from "./entries";
import insightsRouter from "./insights";
import recommendationsRouter from "./recommendations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(entriesRouter);
router.use(insightsRouter);
router.use(recommendationsRouter);

export default router;
