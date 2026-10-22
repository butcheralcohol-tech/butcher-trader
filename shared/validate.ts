import type { RiskConfig } from "./risk.js";
const numericKeys = ["balance", "riskPercent", "dailyLossLimitPercent", "dailyPnl", "openPositions", "maxOpenPositions"] as const;
export type ParsedRisk = { ok:true; value:RiskConfig } | { ok:false; reasons:string[] };
export function parseRiskInput(input:unknown):ParsedRisk {
 if(!input||typeof input!=="object"||Array.isArray(input)) return {ok:false,reasons:["Request body must be a JSON object."]};
 const body=input as Record<string,unknown>;
 if(numericKeys.some(k=>typeof body[k]!=="number"||!Number.isFinite(body[k]))) return {ok:false,reasons:["All numeric risk settings must be finite JSON numbers."]};
 if(typeof body.liveEnabled!=="boolean") return {ok:false,reasons:["liveEnabled must be a boolean."]};
 const market=body.marketGroup===undefined?"SYNTHETIC":body.marketGroup;
 if(market!=="SYNTHETIC"&&market!=="FOREX") return {ok:false,reasons:["marketGroup must be SYNTHETIC or FOREX."]};
 return {ok:true,value:{balance:body.balance as number,riskPercent:body.riskPercent as number,dailyLossLimitPercent:body.dailyLossLimitPercent as number,dailyPnl:body.dailyPnl as number,openPositions:body.openPositions as number,maxOpenPositions:body.maxOpenPositions as number,liveEnabled:body.liveEnabled,marketGroup:market}};
}