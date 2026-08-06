#!/usr/bin/env python3
# 네이버 부동산 수집기 - curl_cffi Chrome TLS (로컬 전용)
# python3 scripts/collectors/naver-collect.py [--limit=N] [--dry-run] [--max-minutes=N]
import sys,os,json,re,time,argparse
from pathlib import Path
from datetime import datetime,date,timedelta,timezone
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
    def insert(tbl,rows):
        r=hx.post(f"{SB_REST}/{tbl}",headers=SB_HEADERS,json=rows)
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
RT_OK=("APT","ABYG","JGC","PRE")  # 수집 대상 매물종류 (마커 필터·매칭 판정 공용)
NAME_SIM_MIN=0.6  # 다운스트림 sync-naver-complex.mjs matchApartments 폴백 임계와 동일 — 어긋나면 굶주림 재발
def log(m):print(f"[naver] {m}")
def _nrm(s):
    """이름 정규화 = 공백 제거. _shared.mjs stringSimilarity 의 replace(/\\s+/g,"") 와 동일."""
    return re.sub(r"\s+","",str(s or ""))
def _cpx_key(s):
    """단지명에서 괄호 묶음 제거 — sync-naver-complex.mjs L66
    `(cpx.complex_name||"").replace(/\\([^)]*\\)/g,"").trim()` 와 동일 전처리.
    다운스트림이 "스타캐슬2차(주상복합)" 을 "스타캐슬2차" 로 놓고 매칭하므로 여기서도 똑같이
    벗겨야 한다. 안 벗기면 다운스트림은 반영할 단지를 우리가 안 받아와 굶주림이 그대로 남는다.
    (아파트명 쪽은 다운스트림도 원문 그대로 쓰므로 건드리지 않는다.)"""
    return re.sub(r"\([^)]*\)","",str(s or "")).strip()
def _lcs_sim(x,y):
    """공백 제거된 두 문자열의 LCS 유사도 = 2*LCS/(len(x)+len(y)).
    _shared.mjs L474-491 stringSimilarity 와 동일 산식 — difflib.SequenceMatcher 는 매칭 블록
    알고리즘이 달라 값이 어긋나므로(0.6 임계 의미가 깨짐) 쓰지 않고 직접 DP 로 포팅.
    2행 롤링 DP (전체 표 대신 이전 행만 유지 — 값은 2차원 DP 와 동일)."""
    m,n=len(x),len(y)
    prev=[0]*(n+1)
    for i in range(1,m+1):
        cur=[0]*(n+1);cx=x[i-1]
        for j in range(1,n+1):
            cur[j]=prev[j-1]+1 if cx==y[j-1] else(cur[j-1] if cur[j-1]>=prev[j] else prev[j])
        prev=cur
    return 2*prev[n]/(m+n)
def sim_name(a,b):
    """stringSimilarity(_shared.mjs) 포팅 — 공백 제거 후 LCS 유사도. 같으면 1, 빈 문자열이면 0."""
    x,y=_nrm(a),_nrm(b)
    if not x or not y:return 0.0
    if x==y:return 1.0
    return _lcs_sim(x,y)
def match_any(name,norm_names,thresh=NAME_SIM_MIN):
    """norm_names(미리 공백 제거된 우리 단지명들) 중 하나라도 thresh 이상이면 True.
    비교 대상을 같은 (region,gu) 그룹으로 한정해 호출할 것 — 전체 단지와 곱하면 LCS 폭발."""
    x=_nrm(name)
    if not x:return False
    m=len(x)
    for y in norm_names:
        if x==y:return True
        n=len(y)
        # LCS 상한 = min(m,n) 이므로 2*min/(m+n) 이 임계에 못 미치면 DP 를 돌려도 절대 통과 못 함
        # → 정확한 사전 컷(거짓 음성 0). 길이비 어림값이 아니라 상한식이라 안전.
        if 2*min(m,n)<thresh*(m+n):continue
        if _lcs_sim(x,y)>=thresh:return True
    return False
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
    # --no-resume: 최근 수집분도 강제 재수집 (기본은 resume ON = 최근 7일 내 받은 단지 건너뜀)
    pa.add_argument("--no-resume",action="store_true")
    # --max-minutes: 1단계 자체 시간예산. 초과 시 매물·시세 루프를 끊고 마무리는 정상 수행(exit 0).
    #   bat 이 2~6단계(sync·presale·units·전용률·점수)로 넘어가야 분양정보·세대수가 갱신되는데,
    #   1단계가 예약작업 제한시간에 통째로 잘리면 그 뒤 단계가 아예 실행되지 않아 한 달 굶주렸음.
    #   남은 단지는 resume(articles.last_seen_at)으로 다음 실행이 이어받는다. 0 이하 = 무제한.
    pa.add_argument("--max-minutes",type=float,default=90)
    a=pa.parse_args()
    # collector_runs 시각은 UTC — .mjs recordCollectorRun(toISOString)과 같은 축(timezone-consistency).
    # articles.last_seen_at 의 로컬 벽시계 축과는 별개 짝(저장·조회가 서로 맞으면 됨).
    t0=time.time();started_at=datetime.now(timezone.utc).isoformat()
    budget=a.max_minutes*60 if a.max_minutes>0 else 0
    def over():return budget>0 and time.time()-t0>budget
    budget_hit=False;skipped=0;failed=0
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
    # resume: 최근 7일 내 last_seen_at 이 찍힌 complex_no = 이미 수집됨 → 매물·시세 skip.
    # 창을 "오늘"에서 7일로 넓힌 이유: --max-minutes 로 한 번에 일부만 수집하므로, 다음 실행(월↔목)이
    # 남은 단지를 이어받아 전체를 여러 번에 걸쳐 순환해야 한다. 오늘 기준이면 매 실행이 처음부터 다시 돌아
    # 앞쪽 단지만 반복 수집하고 뒤쪽은 영원히 굶는다.
    # 시너지: 자매 레포(naver-estate-web)가 같은 articles.last_seen_at 을 찍는 단지는 자동으로 스킵되어,
    #   우리 예산이 "우리만 보는 단지"에 집중된다.
    # DB(articles.last_seen_at)가 진실의 원천 → 체크포인트 파일 동기화 사고 없음(세션 470, schools buildEnrichedIds 답습).
    done_cx=set()
    if not a.dry_run and not a.no_resume:
        # 저장부(last_seen_at=datetime.now().isoformat())와 동일한 datetime.now() 축을 써서
        # 시간축 일관성 보장 — 저장·조회 둘 다 로컬 벽시계(집서버=KST) 기준이라 경계 비교가 정확.
        # (timestamptz 컬럼이 +00:00 딱지를 붙여도 숫자가 같은 축. 저장부가 바뀌면 함께 바꿀 것.)
        since=(datetime.now()-timedelta(days=7)).replace(microsecond=0).isoformat()
        try:
            seen_rows=SB.select("articles","complex_no",[f"last_seen_at=gte.{since}","is_active=eq.true"])
            done_cx={str(r["complex_no"]) for r in seen_rows if r.get("complex_no")}
            if done_cx:log(f"resume: 최근 7일 내 수집한 {len(done_cx)}개 단지 건너뜀 (매물·시세)")
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
    # crawl = 매물·시세를 실제로 받을 단지(complex_no) 집합.
    # 마커는 (region,gu) 그룹 bounding box + 마진 0.03 으로 잡혀 우리 단지 주변 전부(3만+)가 딸려온다.
    # 그 전부에 매물+시세(단지당 5초 스로틀 × 3회 이상)를 돌리면 42시간이 걸려 예약작업 제한시간에 잘렸다.
    # 다운스트림 sync-naver-complex.mjs 는 어차피 이름 유사도 0.6 이상만 apartments 에 반영하므로,
    # 그 임계를 여기서 미리 적용해 "반영될 단지"만 크롤링한다(버려질 데이터를 받느라 굶던 구조 해소).
    cpxs=[];seen=set();crawl=set()
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
        # 이 그룹의 우리 단지명만 미리 정규화 — 마커마다 전체 2,170개와 비교하면 LCS 가 폭발한다.
        anames=[s for s in (_nrm(ap.get("name")) for ap in aps) if s]
        log(f"검색: {region} {gu} ({len(aps)}건, cortar={cortar})")
        try:
            markers=find_markers(cortar,lats,lngs)
            nc=0
            for c in markers:
                cn=str(c.get("markerId",""))
                if not cn:continue
                rt=c.get("realEstateTypeCode","")
                # 매칭 판정은 seen 중복 제거 *이전*에 — 같은 마커가 여러 그룹 bbox 에 걸릴 때
                # 다른 그룹의 우리 단지와 매칭될 기회를 잃지 않게(한 번이라도 매칭되면 대상).
                if cn not in crawl and(not rt or rt in RT_OK)and match_any(_cpx_key(c.get("complexName","")),anames):
                    crawl.add(cn)
                if cn in seen:continue
                seen.add(cn);nc+=1
                if rt and rt not in RT_OK:continue
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
    # 단지 메타(complexes upsert)는 마커 전체를 유지 — 요청 1회(bbox)로 이미 받은 값이라 추가 비용 0.
    # 시간을 잡아먹는 건 단지당 개별 요청이 필요한 매물·시세뿐이라 그쪽만 매칭 단지로 좁힌다.
    targets=[cx for cx in cpxs if cx["complex_no"] in crawl]
    log(f"매물·시세 대상: {len(targets)}건 (매칭 필터, 마커 전체 {len(cpxs)}건)")
    if a.dry_run:
        if cpxs:log(json.dumps(cpxs[0],ensure_ascii=False,indent=2)[:500])
        log("dry-run");return
    ub("complexes",cpxs,"complex_no")
    ta=0
    for i,cx in enumerate(targets):
        if over():
            log(f"시간예산 {a.max_minutes}분 소진 — 남은 {len(targets)-i}단지는 다음 실행이 이어함(resume)")
            budget_hit=True;break
        if(i+1)%50==0:log(f"  {i+1}/{len(targets)}, {ta}매물")
        cn=cx["complex_no"]
        if cn in done_cx:skipped+=1;continue  # resume: 최근 7일 내 수집한 단지 매물 건너뜀
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
        except Exception as e:failed+=1;log(f"  {cn}:{e}")
    log(f"매물 {ta}건")
    log("시세...")
    tp=0
    for i,cx in enumerate(targets):
        if over():
            log(f"시간예산 {a.max_minutes}분 소진 — 시세 남은 {len(targets)-i}단지는 다음 실행이 이어함(resume)")
            budget_hit=True;break
        if(i+1)%50==0:log(f"  시세{i+1}/{len(targets)},{tp}")
        cn=cx["complex_no"]
        if cn in done_cx:continue  # resume: 최근 7일 내 수집한 단지 시세 건너뜀
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
        except Exception as e:failed+=1;log(f"  {cn}:{e}")
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
    # 실행 기록 — 이 수집기가 한 달 내내 잘려 나가는 동안 아무도 몰랐던 이유가 "기록 0" 이었다.
    # (.mjs recordCollectorRun 과 같은 collector_runs 스키마. dry-run 은 위에서 이미 return.)
    # 기록 실패가 파이프라인을 막으면 안 되므로 로그만 남기고 넘어간다.
    try:
        SB.insert("collector_runs",[{"collector":"naver-collect",
            "status":"partial" if budget_hit else "success",
            "ok_count":ta,"fail_count":failed,"skip_count":skipped,
            "elapsed_sec":round(time.time()-t0,1),
            "started_at":started_at,"finished_at":datetime.now(timezone.utc).isoformat()}])
    except Exception as e:log(f"  collector_runs 기록 실패(무시): {e}")
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
