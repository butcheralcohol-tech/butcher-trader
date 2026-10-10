import test from "node:test";import assert from "node:assert/strict";import {evaluateRisk} from "./risk";
const base={accountBalance:1000,riskPercent:0.5,maxDailyLossPercent:2,dailyLossSoFar:0,consecutiveLosses:0,maxConsecutiveLosses:3};
test("allows valid conservative risk check",()=>{const r=evaluateRisk(base);assert.equal(r.allowed,true);assert.equal(r.stake,5);assert.deepEqual(r.reasons,[])});
test("blocks at daily loss cap",()=>{const r=evaluateRisk({...base,dailyLossSoFar:20});assert.equal(r.allowed,false);assert.equal(r.stake,0)});
test("blocks after loss streak",()=>{const r=evaluateRisk({...base,consecutiveLosses:3});assert.equal(r.allowed,false)});
test("rejects risk above one percent",()=>{const r=evaluateRisk({...base,riskPercent:1.5});assert.equal(r.allowed,false)});