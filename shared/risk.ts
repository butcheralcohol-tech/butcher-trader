export type RiskMarket = "SYNTHETIC" | "FOREX";
export type RiskConfig = { balance:number; riskPercent:number; dailyLossLimitPercent:number; dailyLossLimitAmount?:number; sessionLossLimitAmount?:number; sessionPnl?:number; dailyProfitTargetAmount?:number; sessionProfitTargetAmount?:number; dailyPnl:number; openPositions:number; maxOpenPositions:number; liveEnabled:boolean; marketGroup?:RiskMarket };
export type RiskDecision = { allowed:boolean; reasons:string[]; maxRiskAmount:number };
export function evaluateRisk(config:RiskConfig):RiskDecision {
 const reasons:string[]=[];
 const finite=[config.balance,config.riskPercent,config.dailyLossLimitPercent,config.dailyPnl,config.openPositions,config.maxOpenPositions].every(Number.isFinite);
 if(!finite) reasons.push("All numeric risk settings must be finite numbers.");
 if(!Number.isFinite(config.balance)||config.balance<=0) reasons.push("Balance must be positive.");
 if(!Number.isFinite(config.riskPercent)||config.riskPercent<=0||config.riskPercent>1) reasons.push("Per-trade risk must be greater than 0 and at most 1%.");
 if(!Number.isFinite(config.dailyLossLimitPercent)||config.dailyLossLimitPercent<=0||config.dailyLossLimitPercent>3) reasons.push("Daily loss limit must be greater than 0 and at most 3%.");
 if(config.marketGroup!==undefined&&config.marketGroup!=="SYNTHETIC"&&config.marketGroup!=="FOREX") reasons.push("Unsupported market group.");
 if(config.dailyLossLimitAmount!==undefined&&(!Number.isFinite(config.dailyLossLimitAmount)||config.dailyLossLimitAmount<=0)) reasons.push("Daily loss limit must be a positive finite amount.");
 if(config.sessionLossLimitAmount!==undefined&&(!Number.isFinite(config.sessionLossLimitAmount)||config.sessionLossLimitAmount<=0)) reasons.push("Session loss cap must be a positive finite amount.");
 if(config.dailyProfitTargetAmount!==undefined&&(!Number.isFinite(config.dailyProfitTargetAmount)||config.dailyProfitTargetAmount<24)) reasons.push("Daily profit target must be at least $24.");
 if(config.sessionProfitTargetAmount!==undefined&&(!Number.isFinite(config.sessionProfitTargetAmount)||config.sessionProfitTargetAmount<=0)) reasons.push("Session profit target must be a positive finite amount.");
 const pct=config.balance*config.dailyLossLimitPercent/100;
 const reached=config.dailyLossLimitAmount!==undefined?config.dailyPnl<=-config.dailyLossLimitAmount:config.dailyPnl<=-pct;
 if(!Number.isFinite(config.dailyPnl)||reached) reasons.push("Daily loss limit reached; trading is locked until the next trading day.");
 if(config.sessionLossLimitAmount!==undefined && (!Number.isFinite(config.sessionPnl) || config.sessionPnl!<=-config.sessionLossLimitAmount)) reasons.push("Session loss cap reached; no new entries are allowed for this session.");
 if(config.dailyProfitTargetAmount!==undefined&&config.dailyPnl>=config.dailyProfitTargetAmount) reasons.push("Daily profit target reached; new entries are paused until the next trading day.");
 if(config.sessionProfitTargetAmount!==undefined&&Number.isFinite(config.sessionPnl)&&config.sessionPnl>=config.sessionProfitTargetAmount) reasons.push("Session profit target reached; the session is paused and no new entries are allowed.");
 if(!Number.isInteger(config.openPositions)||config.openPositions<0) reasons.push("Open position count must be a non-negative integer.");
 if(!Number.isInteger(config.maxOpenPositions)||config.maxOpenPositions<1||config.maxOpenPositions>1) reasons.push("This milestone allows at most one open position.");
 if(config.openPositions>=config.maxOpenPositions) reasons.push("Maximum open positions reached.");
 if(config.liveEnabled) reasons.push("Live execution is not implemented in this milestone; live orders are blocked.");
 const raw=config.balance*config.riskPercent/100, maxRiskAmount=Number.isFinite(raw)&&config.balance>0&&config.riskPercent>0?Math.round(raw*100)/100:0;
 return {allowed:reasons.length===0,reasons:[...new Set(reasons)],maxRiskAmount:reasons.length===0?maxRiskAmount:0};
}