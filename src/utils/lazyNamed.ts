import { lazy, type ComponentType } from "react";

/**
 * named export 컴포넌트를 React.lazy 로 코드 스플리팅 — `lazy(() => import(p).then(m => ({ default: m.X })))`
 * 보일러플레이트(13곳 반복) 공유 팩토리.
 *
 * ⚠️ import() 호출은 **호출처에서** `() => import("리터럴 경로")` 로 넘겨야 한다. Vite/Rollup 은
 *    import() 안의 **리터럴 경로**를 정적 분석해 청크를 분리하므로, 경로를 이 팩토리 안으로
 *    끌어들이면(동적 변수화) 코드 스플리팅이 깨진다. 경로는 호출처 리터럴 유지, 이름만 인자로 받음.
 *
 * @param factory  () => import("경로 리터럴") — named export 들을 담은 모듈 Promise
 * @param name     default 로 매핑할 named export 키
 */
export function lazyNamed<K extends string>(
  factory: () => Promise<Record<K, ComponentType<any>>>,
  name: K,
) {
  return lazy(() => factory().then((m) => ({ default: m[name] })));
}
