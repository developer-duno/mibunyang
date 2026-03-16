#!/usr/bin/env python3
# 네이버 부동산 수집기 - curl_cffi Chrome TLS (로컬 전용)
# python3 scripts/collectors/naver-collect.py [--limit=N] [--dry-run]
import sys,os,json,re,time,argparse
from pathlib import Path
from datetime import datetime,date
try:
    from curl_cffi import requests as cffi_requests
except ImportError: print("pip install curl_cffi",file=sys.stderr);sys.exit(1)
import httpx

ROOT=Path(__file__).resolve().parent.parent.parent
for ef in [".env.local",".env"]:
    ep=ROOT/ef
    if ep.exists():
        for ln in ep.read_text(encoding="utf8").splitlines():
            ln=ln.strip()
            if not ln or ln.startswith("#"):continue
            eq=ln.find("=")
            if eq>0:
                k,v=ln[:eq].strip(),ln[eq+1:].strip()
                if k and k not in os.environ:os.environ[k]=v
SU=os.environ.get("SUPABASE_URL","").strip()
SK=os.environ.get("SUPABASE_SERVICE_KEY","").strip()
if not SU or not SK:print("SUPABASE_URL+SUPABASE_SERVICE_KEY needed",file=sys.stderr);sys.exit(1)
SB_HEADERS={"apikey":SK,"Authorization":f"Bearer {SK}","Content-Type":"application/json","Prefer":"return=minimal"}
SB_REST=f"{SU}/rest/v1"
hx=httpx.Client(timeout=30)
class SB:
    @staticmethod
    def select(tbl,cols="*",filters=None):
        url=f"{SB_REST}/{tbl}?select={cols}"
        if filters:
            for f in filters:url+=f"&{f}"
        r=hx.get(url,headers=SB_HEADERS)
        r.raise_for_status()
        return r.json()
    @staticmethod
    def upsert(tbl,rows,on_conflict):
        h={**SB_HEADERS,"Prefer":"resolution=merge-duplicates,return=minimal"}
        url=f"{SB_REST}/{tbl}?on_conflict={on_conflict}"
        r=hx.post(url,headers=h,json=rows)
        r.raise_for_status()
    @staticmethod
    def update(tbl,data,filters):
        url=f"{SB_REST}/{tbl}"
        for f in filters:url+=f"&{f}" if "?" in url else f"?{f}"
        r=hx.patch(url,headers=SB_HEADERS,json=data)
        r.raise_for_status()
sb=SB
NV="https://new.land.naver.com"
JPAT=r'"token":"(eyJ[A-Za-z0-9._-]+)"'
M2P=3.3058
ss=cffi_requests.Session(impersonate="chrome")
_jt=None;_jtt=0;_lr=0
REGION_CORTAR={
    "서울":"1100000000","경기":"4100000000","인천":"2800000000",
    "부산":"2600000000","대전":"3000000000","대구":"2700000000",
    "울산":"3100000000","세종":"3600000000","광주":"2900000000",
    "강원":"5100000000","충북":"4300000000","충남":"4400000000",
    "경북":"4700000000","경남":"4800000000","전북":"5200000000",
    "전남":"4600000000","제주":"5000000000",
}
def log(m):print(f"[naver] {m}")
def thr(s=1.0):
    global _lr
    d=time.time()-_lr
    if d<s:time.sleep(s-d)
    _lr=time.time()
def ejwt(cid=None):
    global _jt,_jtt
    if _jt and time.time()-_jtt<2800:return _jt
    thr()
    r=ss.get(f"{NV}/complexes/{cid or 217}",headers={"Accept":"text/html"},timeout=30)
    r.raise_for_status()
    m=re.search(JPAT,r.text)
    if not m:raise RuntimeError("JWT fail")
    _jt=m.group(1);_jtt=time.time()
    log(f"JWT ({_jt[:20]}...)")
    return _jt

def ag(url,params=None,cid=None):
    global _jt
    h={"Accept":"application/json, text/plain, */*","Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8","Referer":"https://new.land.naver.com/"}
    # Always get JWT to maintain session cookies
    t=ejwt(cid)
    h["Authorization"]=f"Bearer {t}"
    if cid:h["Referer"]=f"{NV}/complexes/{cid}"
    for i in range(3):
        try:
            thr()
            r=ss.get(url,params=params,headers=h,timeout=30)
            if r.status_code in(401,403):
                _jt=None;t=ejwt(cid);h["Authorization"]=f"Bearer {t}"
                time.sleep(2);continue
            if r.status_code==429:w=5*(i+1);log(f"429-{w}s");time.sleep(w);continue
            r.raise_for_status();return r.json()
        except Exception as e:
            if i==2:raise
            time.sleep(3*(i+1))
def pp(s):
    if not s:return 0
    s=re.sub(r"[,\s]","",s).replace("만원","")
    ps=s.split("억")
    if len(ps)==2:
        e=(int(ps[0]) if ps[0].strip() else 0)*10000
        r=ps[1]
        return e+((int(re.sub(r"\D","",r)) or 0)*1000 if "천" in r else(int(r) if r.strip() else 0))
    if "천" in s:return(int(re.sub(r"\D","",s)) or 0)*1000
    return int(re.sub(r"\D","",s) or "0")
def ub(tbl,rows,conf,bs=500):
    if not rows:return 0
    t=0
    for i in range(0,len(rows),bs):
        b=rows[i:i+bs]
        try:SB.upsert(tbl,b,conf);t+=len(b)
        except:
            for r in b:
                try:SB.upsert(tbl,[r],conf);t+=1
                except:pass
    log(f"  {tbl}:{t}/{len(rows)}");return t

def get_gu_cortars(city_cortar):
    d=ag(f"{NV}/api/regions/list",{"cortarNo":city_cortar})
    return d.get("regionList",[])

def find_markers(cortar_no,lats,lngs,margin=0.03):
    params={
        "cortarNo":cortar_no,"zoom":"16","priceType":"RETAIL",
        "markerId":"","markerType":"","selectedComplexNo":"",
        "selectedComplexBuildingNo":"","fakeComplexMarker":"",
        "realEstateType":"APT:ABYG:JGC:PRE","tradeType":"",
        "tag":":::::::::",
        "rentPriceMin":"0","rentPriceMax":"900000000",
        "priceMin":"0","priceMax":"900000000",
        "areaMin":"0","areaMax":"900000000",
        "oldBuildYears":"","recentlyBuildYears":"",
        "minHouseHoldCount":"","maxHouseHoldCount":"",
        "showArticle":"false","sameAddressGroup":"true",
        "minMaintenanceCost":"","maxMaintenanceCost":"","directions":"",
        "leftLon":str(min(lngs)-margin),"rightLon":str(max(lngs)+margin),
        "topLat":str(max(lats)+margin),"bottomLat":str(min(lats)-margin),
    }
    d=ag(f"{NV}/api/complexes/single-markers/2.0",params)
    return d if isinstance(d,list) else []

def main():
    pa=argparse.ArgumentParser()
    pa.add_argument("--limit",type=int,default=0)
    pa.add_argument("--dry-run",action="store_true")
    a=pa.parse_args()
    apts=SB.select("apartments","id,name,region,gu,dong,lat,lng",["lat=not.is.null","lng=not.is.null"])
    tgt=apts[:a.limit] if a.limit>0 else apts
    log(f"미분양 {len(tgt)}건 (전체 {len(apts)})")
    # region -> gu cortarNo 캐시
    gu_cache={}
    for rn,cc in REGION_CORTAR.items():
        if not any(ap["region"]==rn for ap in tgt):continue
        gus=get_gu_cortars(cc)
        for g in gus:
            gu_cache[(rn,g["cortarName"])]=g["cortarNo"]
        log(f"  {rn}: {len(gus)}개 구/시")
        time.sleep(0.5)
    # 아파트 그룹핑 (region,gu)
    rg={}
    for ap in tgt:
        k=(ap["region"],ap.get("gu",""))
        rg.setdefault(k,[]).append(ap)
    log(f"{len(rg)}개 지역그룹")
    cpxs=[];seen=set()
    for (region,gu),aps in rg.items():
        lats=[a["lat"] for a in aps if a.get("lat")]
        lngs=[a["lng"] for a in aps if a.get("lng")]
        if not lats or not lngs:continue
        cortar=gu_cache.get((region,gu))
        if not cortar:
            for (rn,gn),cn in gu_cache.items():
                if rn==region and (gn in gu or gu in gn):
                    cortar=cn;break
        if not cortar:cortar=REGION_CORTAR.get(region)
        if not cortar:
            log(f"  {region} {gu}: cortarNo 없음");continue
        nids=[x["id"] for x in aps]
        log(f"검색: {region} {gu} ({len(aps)}건, cortar={cortar})")
        try:
            markers=find_markers(cortar,lats,lngs)
            nc=0
            for c in markers:
                cn=str(c.get("markerId",""))
                if not cn or cn in seen:continue
                seen.add(cn);nc+=1
                rt=c.get("realEstateTypeCode","")
                if rt and rt not in("APT","ABYG","JGC","PRE"):continue
                cpxs.append({"complex_no":cn,"complex_name":c.get("complexName",""),
                    "real_estate_type":rt or None,
                    "lat":float(c["latitude"]) if c.get("latitude") else None,
                    "lng":float(c["longitude"]) if c.get("longitude") else None,
                    "total_households":c.get("totalHouseholdCount") or c.get("householdCount"),
                    "use_approve_ymd":c.get("completionYearMonth"),
                    "construction_company":c.get("constructionCompanyName"),
                    "nearby_apartment_ids":nids,
                    "last_crawled_at":datetime.now().isoformat()})
            log(f"  -> {len(markers)} 마커, {nc} 신규")
        except Exception as e:log(f"  실패:{e}")
    log(f"단지 총 {len(cpxs)}건")
    if a.dry_run:
        if cpxs:log(json.dumps(cpxs[0],ensure_ascii=False,indent=2)[:500])
        log("dry-run");return
    ub("naver_complexes",cpxs,"complex_no")
    ta=0
    for i,cx in enumerate(cpxs):
        if(i+1)%50==0:log(f"  {i+1}/{len(cpxs)}, {ta}매물")
        cn=cx["complex_no"]
        try:
            sa=set();arts=[];pg=1
            while True:
                d=ag(f"{NV}/api/articles/complex/{cn}",{"page":str(pg),"complexNo":cn,"tradeType":"","sameAddressGroup":"true"},cn)
                al=d.get("articleList",[])
                if not al:break
                for x in al:
                    an=str(x["articleNo"]);sa.add(an)
                    pr=pp(x.get("dealOrWarrantPrc"));a2=float(x["area2"]) if x.get("area2") else None
                    ppp=round(pr/(a2/M2P)) if pr and a2 and a2>0 else None
                    arts.append({"article_no":an,"complex_no":cn,"trade_type":x.get("tradeTypeName",""),
                        "price":pr or None,"rent_price":pp(x.get("rentPrc")) or None,
                        "supply_area":float(x["area1"]) if x.get("area1") else None,
                        "exclusive_area":a2,"pp":ppp,"floor_info":x.get("floorInfo"),
                        "direction":x.get("direction"),"is_active":True,
                        "last_seen_at":datetime.now().isoformat(),"recorded_at":date.today().isoformat()})
                if not d.get("isMoreData"):break
                pg+=1;time.sleep(1.5)
            if arts:ub("naver_articles",arts,"article_no");ta+=len(arts)
            if sa:
                try:SB.update("naver_articles",{"is_active":False},[f"complex_no=eq.{cn}","is_active=eq.true",f"article_no=not.in.({chr(44).join(sa)})"])
                except:pass
        except Exception as e:log(f"  {cn}:{e}")
    log(f"매물 {ta}건")
    log("시세...")
    tp=0
    for i,cx in enumerate(cpxs):
        if(i+1)%50==0:log(f"  시세{i+1}/{len(cpxs)},{tp}")
        cn=cx["complex_no"]
        try:
            rows=[]
            for tt in["A1","B1"]:
                d=ag(f"{NV}/api/complexes/{cn}/prices",{"complexNo":cn,"tradeType":tt,"year":"5","priceChartChange":"true","type":"table"},cn)
                area_no=str(d.get("areaNo")) if d.get("areaNo") is not None else None
                items=d.get("marketPrices") or d.get("realEstatePrice",{}).get("monthlyPrices") or []
                if not isinstance(items,list):continue
                for it in items:
                    bm=str(it.get("baseYearMonthDay") or it.get("baseYearMonth") or "")
                    if not bm:continue
                    rows.append({"complex_no":cn,"trade_type":tt,
                        "area_no":area_no,
                        "deal_price_upper":it.get("dealUpperPriceLimit") or it.get("dealUpperPrice"),
                        "deal_price_lower":it.get("dealLowPriceLimit") or it.get("dealLowerPrice"),
                        "lease_price_upper":it.get("leaseUpperPriceLimit") or it.get("leaseUpperPrice"),
                        "lease_price_lower":it.get("leaseLowPriceLimit") or it.get("leaseLowerPrice"),
                        "base_month":bm[:6],"recorded_at":date.today().isoformat()})
            if rows:ub("naver_price_history",rows,"complex_no,trade_type,area_no,base_month");tp+=len(rows)
        except Exception as e:log(f"  {cn}:{e}")
    log(f"시세 {tp}건")
    log("완료!")

if __name__=="__main__":
    main()
