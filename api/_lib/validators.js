// RFC 5322 에 느슨하게 맞춘 이메일 정규식 — auth/signup·login·admin/review 공용
// 정책: 길이 <=254, 한 글자 TLD 금지, 공백·제어문자 금지
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && EMAIL_RE.test(email);
}
