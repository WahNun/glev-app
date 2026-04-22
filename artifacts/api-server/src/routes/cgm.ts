import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/cgm/latest", (_req, res): void => {
  const glucose = Math.round(95 + Math.random() * 25);
  res.json({
    glucose,
    source: "mock",
    timestamp: new Date().toISOString(),
    note: "Mock CGM — replace with Dexcom/Libre API",
  });
});

export default router;
