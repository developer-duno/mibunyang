const BRAND_TIER = {
  "\ud604\ub300\uac74\uc124": { tier: "1Super", score: 20, adj: 1.05 },
  "\uc0bc\uc131\ubb3c\uc0b0": { tier: "1Super", score: 20, adj: 1.05 },
  "GS\uac74\uc124": { tier: "1Super", score: 20, adj: 1.05 },
  "\ub86f\ub370\uac74\uc124": { tier: "1", score: 15, adj: 1.02 },
  "\ub300\uc6b0\uac74\uc124": { tier: "1", score: 15, adj: 1.02 },
  "HDC\ud604\ub300\uc0b0\uc5c5\uac1c\ubc1c": { tier: "1", score: 15, adj: 1.02 },
  "DL\uc774\uc559\uc528": { tier: "1", score: 15, adj: 1.02 },
  "\ud3ec\uc2a4\ucf54\uc774\uc559\uc528": { tier: "1", score: 15, adj: 1.02 },
  "\ud55c\ud654\uac74\uc124": { tier: "2", score: 10, adj: 1.0 },
  "\ud0dc\uc601\uac74\uc124": { tier: "2", score: 10, adj: 1.0 },
};

const AGE_PREMIUM = [
  { min: 0, max: 1, coeff: 1.03 },
  { min: 1, max: 3, coeff: 1.05 },
  { min: 3, max: 5, coeff: 1.10 },
  { min: 5, max: 10, coeff: 1.18 },
  { min: 10, max: 15, coeff: 1.30 },
  { min: 15, max: 20, coeff: 1.42 },
  { min: 20, max: 99, coeff: 1.55 },
];

const PROFILES = {
  live:     { w: { location: 40, product: 20, price: 20, risk: 10, benefit: 5, future: 5 } },
  invest:   { w: { location: 15, product: 10, price: 30, risk: 25, benefit: 10, future: 10 } },
  newlywed: { w: { location: 30, product: 15, price: 30, risk: 10, benefit: 10, future: 5 } },
  edu:      { w: { location: 45, product: 20, price: 15, risk: 10, benefit: 5, future: 5 } },
  retire:   { w: { location: 35, product: 25, price: 20, risk: 15, benefit: 5, future: 0 } },
};

const LAYOUT_SCORE = { "4BAP": 10, "4BAT": 8, "3BAP": 7, "3BAT": 5, "2BA": 3 };
const NOXIOUS_PENALTY = { "rail": -5 };

const CITY_TIER = {
  S: { subwayW: 1.0, busW: 0.7, icW: 0.6, ktxW: 0.8 },
  A: { subwayW: 0.9, busW: 0.85, icW: 0.7, ktxW: 0.9 },
  B: { subwayW: 0.7, busW: 0.9, icW: 0.8, ktxW: 0.9 },
  C: { subwayW: 0.4, busW: 1.0, icW: 1.0, ktxW: 1.0 },
  D: { subwayW: 0.1, busW: 1.0, icW: 1.0, ktxW: 0.5 },
};

const REGIONS_TIER = {
  "seoul": "S", "busan": "A", "daegu": "A", "gwangju": "A", "daejeon": "A",
  "sejong": "B", "gyeonggi": "B",
  "chungnam": "C", "gyeongnam": "C", "gangwon": "C", "jeju": "C",
};

const UNSOLD = [
  { id:"s1", name:"Raemian Wonpentas", region:"seoul", price:135000, units:641, builder:"\uc0bc\uc131\ubb3c\uc0b0", completion:"2026-12", subwayDist:250, busRoutes:30, icDist:4, ktxDist:15, schoolScore:95, hospital:8, mart:3, conv:20, park:4, cafe:40, culture:5, bank:8, pharmacy:6, noxious:[], view:"blue", sunlight:"good", noise:55, layout:"4BAP", parkingRatio:1.55, floorAreaRatio:299, energyGrade:1, greenBldg:"best", quakeDesign:true, exclusiveRatio:79.2, hasPool:true, area:84, discountPct:0, loanFree:false, loanFreePct:0, optionFree:false, optionValue:0, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:1.9, recentTrades6m:85, supplyRatio:35, builderCreditGrade:"AA", builderDebtRatio:80, hugGuarantee:true, isRegulated:true, dsr40pass:true, popGrowth:0.1, transitDev:"existing", devDist:0.3, cityDev:"rebuild", industryDev:"", nearbyMedian:145000, jeonseRate:42, pir:22, psr:0.93, dataReliability:98 },
  { id:"g1", name:"Hwaseong Dongtan Xi", region:"gyeonggi", price:62000, units:2300, builder:"GS\uac74\uc124", completion:"2026-06", subwayDist:800, busRoutes:15, icDist:2.5, ktxDist:5, schoolScore:82, hospital:4, mart:3, conv:15, park:3, cafe:20, culture:2, bank:4, pharmacy:3, noxious:[], view:"green", sunlight:"good", noise:50, layout:"4BAP", parkingRatio:1.48, floorAreaRatio:230, energyGrade:1, greenBldg:"best", quakeDesign:true, exclusiveRatio:78.1, hasPool:true, area:84, discountPct:3, loanFree:true, loanFreePct:50, optionFree:true, optionValue:800, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:5.2, recentTrades6m:55, supplyRatio:145, builderCreditGrade:"AA-", builderDebtRatio:95, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:2.5, transitDev:"existing", devDist:1.0, cityDev:"newcity", industryDev:"semiconductor", nearbyMedian:58000, jeonseRate:58, pir:9.5, psr:0.94, dataReliability:92 },
  { id:"b1", name:"Haeundae LCT Thezip", region:"busan", price:72000, units:980, builder:"\ud3ec\uc2a4\ucf54\uc774\uc559\uc528", completion:"2026-08", subwayDist:400, busRoutes:20, icDist:3, ktxDist:25, schoolScore:75, hospital:5, mart:2, conv:14, park:3, cafe:30, culture:3, bank:4, pharmacy:3, noxious:[], view:"blue", sunlight:"good", noise:52, layout:"4BAT", parkingRatio:1.52, floorAreaRatio:350, energyGrade:1, greenBldg:"best", quakeDesign:true, exclusiveRatio:77.5, hasPool:true, area:84, discountPct:4, loanFree:true, loanFreePct:60, optionFree:false, optionValue:0, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:3.6, recentTrades6m:42, supplyRatio:95, builderCreditGrade:"A+", builderDebtRatio:135, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-0.3, transitDev:"existing", devDist:0.5, cityDev:"tourism", industryDev:"", nearbyMedian:68000, jeonseRate:48, pir:12, psr:0.95, dataReliability:90 },
  { id:"d1", name:"Yuseong Thezip Forena", region:"daejeon", price:42000, units:850, builder:"\ud3ec\uc2a4\ucf54\uc774\uc559\uc528", completion:"2026-03", subwayDist:650, busRoutes:12, icDist:3.5, ktxDist:8, schoolScore:78, hospital:3, mart:2, conv:8, park:2, cafe:15, culture:1, bank:3, pharmacy:2, noxious:[], view:"green", sunlight:"ok", noise:55, layout:"4BAP", parkingRatio:1.45, floorAreaRatio:220, energyGrade:2, greenBldg:"good", quakeDesign:true, exclusiveRatio:78.5, hasPool:false, area:84, discountPct:5, loanFree:true, loanFreePct:60, optionFree:true, optionValue:750, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:5.5, recentTrades6m:28, supplyRatio:124, builderCreditGrade:"A+", builderDebtRatio:135, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:0.3, transitDev:"planned", devDist:1.2, cityDev:"residential", industryDev:"nano", nearbyMedian:37800, jeonseRate:68, pir:6.2, psr:0.90, dataReliability:85 },
  { id:"d2", name:"Dunsan Prugio City", region:"daejeon", price:48000, units:1200, builder:"\ub300\uc6b0\uac74\uc124", completion:"2026-06", subwayDist:380, busRoutes:22, icDist:5, ktxDist:12, schoolScore:92, hospital:5, mart:3, conv:12, park:3, cafe:25, culture:3, bank:5, pharmacy:4, noxious:[], view:"sky", sunlight:"good", noise:60, layout:"4BAT", parkingRatio:1.52, floorAreaRatio:280, energyGrade:1, greenBldg:"best", quakeDesign:true, exclusiveRatio:76.2, hasPool:true, area:84, discountPct:3, loanFree:true, loanFreePct:60, optionFree:false, optionValue:0, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:1.9, recentTrades6m:45, supplyRatio:80, builderCreditGrade:"AA-", builderDebtRatio:110, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:0.5, transitDev:"none", devDist:99, cityDev:"remodel", industryDev:"", nearbyMedian:44200, jeonseRate:62, pir:7.1, psr:0.92, dataReliability:92 },
  { id:"dg1", name:"Suseong Hillstate", region:"daegu", price:55000, units:750, builder:"\ud604\ub300\uac74\uc124", completion:"2026-05", subwayDist:350, busRoutes:18, icDist:5, ktxDist:10, schoolScore:88, hospital:4, mart:2, conv:11, park:2, cafe:18, culture:2, bank:4, pharmacy:3, noxious:[], view:"green", sunlight:"good", noise:52, layout:"4BAP", parkingRatio:1.50, floorAreaRatio:240, energyGrade:1, greenBldg:"good", quakeDesign:true, exclusiveRatio:79.0, hasPool:false, area:84, discountPct:3, loanFree:true, loanFreePct:50, optionFree:false, optionValue:0, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:5.3, recentTrades6m:35, supplyRatio:110, builderCreditGrade:"AA", builderDebtRatio:85, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-0.5, transitDev:"planned", devDist:2.0, cityDev:"medical", industryDev:"", nearbyMedian:52000, jeonseRate:55, pir:8.5, psr:0.95, dataReliability:88 },
  { id:"gj1", name:"Gwangju Cheomdan", region:"gwangju", price:35000, units:600, builder:"DL\uc774\uc559\uc528", completion:"2026-02", subwayDist:500, busRoutes:14, icDist:3, ktxDist:20, schoolScore:70, hospital:3, mart:2, conv:8, park:2, cafe:10, culture:1, bank:2, pharmacy:2, noxious:[], view:"green", sunlight:"ok", noise:48, layout:"4BAP", parkingRatio:1.40, floorAreaRatio:210, energyGrade:2, greenBldg:"good", quakeDesign:true, exclusiveRatio:77.8, hasPool:false, area:84, discountPct:7, loanFree:true, loanFreePct:80, optionFree:true, optionValue:600, balconyFree:true, balconyValue:1500, cashback:0, unsoldRate:13.3, recentTrades6m:15, supplyRatio:140, builderCreditGrade:"A", builderDebtRatio:165, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-0.4, transitDev:"planned", devDist:1.5, cityDev:"techno", industryDev:"AI hub", nearbyMedian:30000, jeonseRate:72, pir:5.0, psr:0.84, dataReliability:78 },
  { id:"sj1", name:"Sejong Assembly Forena", region:"sejong", price:47000, units:1100, builder:"\ud55c\ud654\uac74\uc124", completion:"2026-04", subwayDist:9999, busRoutes:10, icDist:2, ktxDist:30, schoolScore:80, hospital:2, mart:2, conv:6, park:4, cafe:8, culture:1, bank:2, pharmacy:1, noxious:[], view:"green", sunlight:"good", noise:42, layout:"4BAP", parkingRatio:1.60, floorAreaRatio:190, energyGrade:1, greenBldg:"best", quakeDesign:true, exclusiveRatio:80.5, hasPool:false, area:84, discountPct:4, loanFree:true, loanFreePct:60, optionFree:false, optionValue:0, balconyFree:false, balconyValue:0, cashback:0, unsoldRate:5.0, recentTrades6m:30, supplyRatio:160, builderCreditGrade:"A+", builderDebtRatio:120, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:3.5, transitDev:"existing", devDist:0.8, cityDev:"complex", industryDev:"assembly", nearbyMedian:43000, jeonseRate:60, pir:6.8, psr:0.91, dataReliability:85 },
  { id:"cn1", name:"Cheonan Buldang iPark", region:"chungnam", price:45000, units:900, builder:"HDC\ud604\ub300\uc0b0\uc5c5\uac1c\ubc1c", completion:"2026-07", subwayDist:1200, busRoutes:10, icDist:2, ktxDist:3, schoolScore:75, hospital:3, mart:2, conv:9, park:2, cafe:12, culture:1, bank:3, pharmacy:2, noxious:[], view:"sky", sunlight:"ok", noise:55, layout:"4BAP", parkingRatio:1.42, floorAreaRatio:225, energyGrade:2, greenBldg:"good", quakeDesign:true, exclusiveRatio:78.0, hasPool:false, area:84, discountPct:5, loanFree:true, loanFreePct:70, optionFree:true, optionValue:500, balconyFree:false, balconyValue:0, cashback:200, unsoldRate:6.7, recentTrades6m:22, supplyRatio:130, builderCreditGrade:"A+", builderDebtRatio:140, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:0.8, transitDev:"existing", devDist:1.0, cityDev:"newtown", industryDev:"SDI factory", nearbyMedian:40000, jeonseRate:65, pir:6.0, psr:0.89, dataReliability:82 },
  { id:"gn1", name:"Changwon Jungang Prugio", region:"gyeongnam", price:38000, units:700, builder:"\ub300\uc6b0\uac74\uc124", completion:"2025-11", subwayDist:9999, busRoutes:16, icDist:3, ktxDist:8, schoolScore:68, hospital:3, mart:2, conv:7, park:1, cafe:10, culture:1, bank:3, pharmacy:2, noxious:["rail"], view:"sky", sunlight:"ok", noise:62, layout:"3BAP", parkingRatio:1.35, floorAreaRatio:235, energyGrade:2, greenBldg:"normal", quakeDesign:true, exclusiveRatio:76.5, hasPool:false, area:84, discountPct:8, loanFree:true, loanFreePct:100, optionFree:true, optionValue:500, balconyFree:true, balconyValue:1600, cashback:100, unsoldRate:13.6, recentTrades6m:10, supplyRatio:150, builderCreditGrade:"A", builderDebtRatio:160, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-0.8, transitDev:"existing", devDist:0.5, cityDev:"remodel", industryDev:"", nearbyMedian:32000, jeonseRate:74, pir:5.2, psr:0.84, dataReliability:75 },
  { id:"gw1", name:"Chuncheon Hupyeong Desiang", region:"gangwon", price:32000, units:450, builder:"\ud0dc\uc601\uac74\uc124", completion:"2025-10", subwayDist:2500, busRoutes:8, icDist:4, ktxDist:2, schoolScore:60, hospital:2, mart:1, conv:5, park:3, cafe:6, culture:0, bank:2, pharmacy:1, noxious:[], view:"blue", sunlight:"ok", noise:45, layout:"3BAP", parkingRatio:1.30, floorAreaRatio:210, energyGrade:2, greenBldg:"normal", quakeDesign:true, exclusiveRatio:76.0, hasPool:false, area:84, discountPct:10, loanFree:true, loanFreePct:100, optionFree:true, optionValue:400, balconyFree:true, balconyValue:1200, cashback:200, unsoldRate:24.4, recentTrades6m:5, supplyRatio:180, builderCreditGrade:"A-", builderDebtRatio:180, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-1.2, transitDev:"existing", devDist:1.5, cityDev:"tourism", industryDev:"", nearbyMedian:25000, jeonseRate:78, pir:4.5, psr:0.78, dataReliability:68 },
  { id:"jj1", name:"Jeju Nohyeong LotteCastle", region:"jeju", price:40000, units:350, builder:"\ub86f\ub370\uac74\uc124", completion:"2026-01", subwayDist:9999, busRoutes:8, icDist:5, ktxDist:9999, schoolScore:62, hospital:2, mart:1, conv:6, park:2, cafe:12, culture:1, bank:2, pharmacy:1, noxious:[], view:"blue", sunlight:"good", noise:40, layout:"3BAT", parkingRatio:1.25, floorAreaRatio:200, energyGrade:2, greenBldg:"normal", quakeDesign:true, exclusiveRatio:75.5, hasPool:false, area:84, discountPct:6, loanFree:true, loanFreePct:80, optionFree:true, optionValue:500, balconyFree:true, balconyValue:1300, cashback:0, unsoldRate:21.4, recentTrades6m:8, supplyRatio:170, builderCreditGrade:"A", builderDebtRatio:155, hugGuarantee:true, isRegulated:false, dsr40pass:true, popGrowth:-0.6, transitDev:"none", devDist:99, cityDev:"airport", industryDev:"", nearbyMedian:35000, jeonseRate:50, pir:7.0, psr:0.88, dataReliability:72 },
];

// I need to replicate the EXACT scoring logic from the JSX, using original Korean values.
// Let me just run the original logic directly by copy-pasting.
// Since the encoding issues may occur, let me write a simpler approach.
// I will hard-code the mapping instead.

console.log("Replicating with exact original logic...");
console.log("(Using mapped values to avoid encoding issues)");
