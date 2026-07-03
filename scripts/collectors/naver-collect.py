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
from filelock import FileLock, Timeout  # 중복 실행 방지 (tox-dev/filelock, stale-lock 자동 처리)

# stdout/stderr 을 UTF-8 로 강제 — Windows 기본 cp949 콘솔에서 한글 print 가
# UnicodeEncodeError 로 죽는 것 방지(세션 470). 배치의 chcp 65001 에 의존하지 않게 코드에서 고정.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass  # reconfigure 미지원 환경(구 파이썬 등)은 무시 — 있으면 적용, 없으면 기존 동작

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
        # PostgREST 기본 1000행 제한 → 페이지네이션
        all_rows=[];off=0;ps=1000
        while True:
            h={**SB_HEADERS,"Range":f"{off}-{off+ps-1}","Prefer":"count=exact"}
            r=hx.get(url,headers=h)
            if r.status_code==416:break  # Range Not Satisfiable → 끝
            r.raise_for_status()
            rows=r.json()
            if not rows:break
            all_rows.extend(rows)
            if len(rows)<ps:break
            off+=ps
        return all_rows
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
ss=None  # main()에서 proxy 포함 초기화
_jt=None;_jtt=0;_lr=0
COMPLEX_DETAILS={}  # ejwt()에서 파싱한 단지 상세 캐시
REGION_CORTAR={
    "서울":"1100000000","경기":"4100000000","인천":"2800000000",
    "부산":"2600000000","대전":"3000000000","대구":"2700000000",
    "울산":"3100000000","세종":"3600000000","광주":"2900000000",
    "강원":"5100000000","충북":"4300000000","충남":"4400000000",
    "경북":"4700000000","경남":"4800000000","전북":"5200000000",
    "전남":"4600000000","제주":"5000000000",
}
def log(m):print(f"[naver] {m}")
def _safe_float(v):
    """문자열/숫자 → float 변환. 실패 시 None."""
    if v is None:return None
    try:return float(str(v).replace("%","").strip())
    except(ValueError,TypeError):return None
def _extract_json_obj(html,key):
    """HTML에서 key에 해당하는 JSON 객체를 brace-balanced 방식으로 추출."""
    pat=re.search(rf'"{key}"\s*:\s*\{{',html)
    if not pat:return None
    start=pat.end()-1
    depth=0
    for i in range(start,min(start+10000,len(html))):
        if html[i]=="{":depth+=1
        elif html[i]=="}":depth-=1
        if depth==0:
            try:return json.loads(html[start:i+1])
            except json.JSONDecodeError:return None
    return None
def thr(s=5.0):
    # 세션118 긴급 완화: 네이버 IP 쿨다운 대응 (cooldown_fix.md ②)
    # 기본 요청 간격 1초 → 5초로 상향 (naver-listings.mjs MIN_INTERVAL과 일치)
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
    # 단지 상세 추출 (같은 HTML에서, 추가 API 호출 없음)
    if cid:
        try:
            d=_extract_json_obj(r.text,"complexDetail")
            if d:
                COMPLEX_DETAILS[str(cid)]={
                    # earthquake_design, entrance_type, building_coverage_ratio — DB 미존재 (Phase 3 실사)
                    "heat_method_type":d.get("heatMethodTypeName"),
                    "heat_fuel_type":d.get("heatFuelTypeName"),
                    "corridor_type":d.get("corridorTypeName"),
                }
        except Exception as e:
            log(f"  complexDetail parse fail (cid={cid}): {e}")
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
    t=0;fail=0
    for i in range(0,len(rows),bs):
        b=rows[i:i+bs]
        try:SB.upsert(tbl,b,conf);t+=len(b)
        except Exception as be:
            log(f"  배치 {i}~{i+len(b)} 실패: {be}, 개별 재시도")
            for r in b:
                try:SB.upsert(tbl,[r],conf);t+=1
                except Exception as re:
                    fail+=1
                    log(f"  개별 실패 ({tbl}): {re}")
    if fail:log(f"  {tbl}: {t}/{len(rows)} 성공, {fail}건 실패")
    else:log(f"  {tbl}:{t}/{len(rows)}")
    return t

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
    pa.add_argument("--proxy",type=str,default="")
    # --no-resume: 오늘 이미 받은 단지도 강제 재수집 (기본은 resume ON = 오늘 받은 단지 건너뜀)
    pa.add_argument("--no-resume",action="store_true")
    a=pa.parse_args()
    global ss
    proxy_url=a.proxy or os.environ.get("NAVER_PROXY","")
    if proxy_url:
        ss=cffi_requests.Session(impersonate="chrome",proxies={"https":proxy_url,"http":proxy_url})
        log(f"Proxy: {proxy_url}")
    else:
        ss=cffi_requests.Session(impersonate="chrome")
    apts=SB.select("apartments","id,name,region,gu,dong,lat,lng",["lat=not.is.null","lng=not.is.null"])
    tgt=apts[:a.limit] if a.limit>0 else apts
    log(f"미분양 {len(tgt)}건 (전체 {len(apts)})")
    # resume: 오늘(KST) 이미 last_seen_at 이 찍힌 complex_no = 이번 사이클에 이미 수집됨 → 매물·시세 skip.
    # 멈췄다 재시도(스케줄러 10분 후) 시 이어서 돌게 함. 다음 발화(월/목)는 날짜가 바뀌어 전부 재수집 = 신선도 유지.
    # DB(articles.last_seen_at)가 진실의 원천 → 체크포인트 파일 동기화 사고 없음(세션 470, schools buildEnrichedIds 답습).
    done_cx=set()
    if not a.dry_run and not a.no_resume:
        # 저장부(L~310 last_seen_at=datetime.now().isoformat())와 동일한 datetime.now() 축을 써서
        # 시간축 일관성 보장 — 저장·조회 둘 다 로컬 벽시계(집서버=KST) 기준이라 "같은 날짜"로 일치.
        # (timestamptz 컬럼이 +00:00 딱지를 붙여도 숫자가 같은 축이라 날짜 비교 정확. 저장부가 바뀌면 함께 바꿀 것.)
        today=datetime.now().strftime("%Y-%m-%d")
        try:
            seen_rows=SB.select("articles","complex_no",[f"last_seen_at=gte.{today}T00:00:00","is_active=eq.true"])
            done_cx={str(r["complex_no"]) for r in seen_rows if r.get("complex_no")}
            if done_cx:log(f"resume: 오늘 이미 수집한 {len(done_cx)}개 단지 건너뜀 (매물·시세)")
        except Exception as e:
            log(f"resume 조회 실패 — 전체 수집으로 진행(fail-open): {e}");done_cx=set()
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
        if not gu:continue
        cortar=gu_cache.get((region,gu))
        if not cortar:
            for (rn,gn),cn in gu_cache.items():
                if rn==region and gn and (gn in gu or gu in gn):
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
                    "real_estate_type_code":rt or None,
                    "latitude":float(c["latitude"]) if c.get("latitude") else None,
                    "longitude":float(c["longitude"]) if c.get("longitude") else None,
                    "total_household_count":c.get("totalHouseholdCount") or c.get("householdCount"),
                    "use_approve_ymd":c.get("completionYearMonth"),
                    "construction_company":c.get("constructionCompanyName"),
                    "last_crawled_at":datetime.now().isoformat()})
            log(f"  -> {len(markers)} 마커, {nc} 신규")
        except Exception as e:log(f"  실패:{e}")
    log(f"단지 총 {len(cpxs)}건")
    if a.dry_run:
        if cpxs:log(json.dumps(cpxs[0],ensure_ascii=False,indent=2)[:500])
        log("dry-run");return
    ub("complexes",cpxs,"complex_no")
    ta=0
    for i,cx in enumerate(cpxs):
        if(i+1)%50==0:log(f"  {i+1}/{len(cpxs)}, {ta}매물")
        cn=cx["complex_no"]
        if cn in done_cx:continue  # resume: 오늘 이미 수집한 단지 매물 건너뜀
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
                    arts.append({"article_no":an,"complex_no":cn,"trade_type_name":x.get("tradeTypeName",""),
                        "numeric_price":pr or None,"numeric_rent_price":pp(x.get("rentPrc")) or None,
                        "area1_m2":float(x["area1"]) if x.get("area1") else None,
                        "area2_m2":a2,"price_per_pyeong":ppp,"floor_info":x.get("floorInfo"),
                        "direction":x.get("direction"),"is_active":True,
                        "last_seen_at":datetime.now().isoformat()})
                if not d.get("isMoreData"):break
                pg+=1;time.sleep(1.5)
            if arts:ub("articles",arts,"article_no");ta+=len(arts)
            if sa:
                try:SB.update("articles",{"is_active":False},[f"complex_no=eq.{cn}","is_active=eq.true",f"article_no=not.in.({chr(44).join(sa)})"])
                except Exception as de:
                    log(f"  소프트삭제 실패 {cn}, 재시도: {de}")
                    time.sleep(1)
                    try:SB.update("articles",{"is_active":False},[f"complex_no=eq.{cn}","is_active=eq.true",f"article_no=not.in.({chr(44).join(sa)})"])
                    except Exception as de2:log(f"  소프트삭제 최종실패 {cn}: {de2}")
        except Exception as e:log(f"  {cn}:{e}")
    log(f"매물 {ta}건")
    log("시세...")
    tp=0
    for i,cx in enumerate(cpxs):
        if(i+1)%50==0:log(f"  시세{i+1}/{len(cpxs)},{tp}")
        cn=cx["complex_no"]
        if cn in done_cx:continue  # resume: 오늘 이미 수집한 단지 시세 건너뜀
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
                    up=it.get("dealUpperPriceLimit") or it.get("dealUpperPrice") or it.get("leaseUpperPriceLimit") or it.get("leaseUpperPrice")
                    lo=it.get("dealLowPriceLimit") or it.get("dealLowerPrice") or it.get("leaseLowPriceLimit") or it.get("leaseLowerPrice")
                    avg=round((up+lo)/2) if up and lo else up or lo
                    rows.append({"complex_no":cn,"trade_type":tt,
                        "area_no":area_no,
                        "price_upper":up,"price_lower":lo,"price_avg":avg,
                        "base_month":bm[:8].ljust(8,"0")})
            if rows:
                # upsert 방식 (DELETE+INSERT 대신 — INSERT 실패 시 데이터 손실 방지)
                tp+=ub("complex_price_history",rows,"complex_no,trade_type,area_no,base_month")
        except Exception as e:log(f"  {cn}:{e}")
    log(f"시세 {tp}건")
    # 단지 상세 정보 (ejwt에서 수집) → complexes UPDATE
    if COMPLEX_DETAILS and not a.dry_run:
        du=0
        for cn,det in COMPLEX_DETAILS.items():
            row={k:v for k,v in det.items() if v is not None}
            if not row:continue
            try:sb.update("complexes",row,[f"complex_no=eq.{cn}"]);du+=1
            except Exception as e:log(f"  complexes update fail ({cn}): {e}")
        log(f"상세 {du}/{len(COMPLEX_DETAILS)}건")
    elif COMPLEX_DETAILS:
        log(f"[DRY-RUN] 상세 {len(COMPLEX_DETAILS)}건 수집됨")
    log("완료!")

if __name__=="__main__":
    # 중복 실행 방지 — 이미 다른 수집기가 돌고 있으면 즉시 정상 종료(좀비 더미 차단, 세션 470).
    # timeout=0: 락이 이미 잡혀 있으면 기다리지 않고 바로 Timeout. 프로세스 죽으면 OS 파일락 자동 해제.
    _lock=FileLock(str(ROOT/".naver-collect.lock"),timeout=0)
    try:
        _lock.acquire()
    except Timeout:
        log("이미 다른 네이버 수집기가 실행 중 — 중복 방지로 종료");sys.exit(0)  # exit 0 = 정상(겹침 회피는 실패 아님)
    try:
        main()
    finally:
        _lock.release()
