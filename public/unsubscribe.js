// 분양 알림 수신거부 페이지 — URL 쿼리(phone·token)로 DELETE /api/subscribers 호출.
// CSP script-src 'self' 준수를 위해 인라인 스크립트 아닌 외부 파일로 분리 (세션 444).
(function () {
  var params = new URLSearchParams(window.location.search);
  var phone = (params.get("phone") || "").trim();
  var token = (params.get("token") || "").trim();
  var statusEl = document.getElementById("status");
  var btn = document.getElementById("optOutBtn");
  var phoneDisplay = document.getElementById("phoneDisplay");

  function setStatus(kind, text) {
    statusEl.className = "status " + kind;
    statusEl.textContent = text;
  }

  // 화면 표시는 끝 4자리만 (개인정보 최소 노출)
  function maskPhone(p) {
    var digits = p.replace(/\D/g, "");
    if (digits.length < 4) return "***";
    return "010-****-" + digits.slice(-4);
  }

  if (!phone || !token) {
    phoneDisplay.textContent = "—";
    setStatus("info", "수신거부 링크가 올바르지 않습니다. 알림톡에 포함된 '수신거부' 링크를 통해 접속해주세요.");
    return;
  }

  phoneDisplay.textContent = maskPhone(phone);
  btn.disabled = false;

  btn.addEventListener("click", function () {
    btn.disabled = true;
    setStatus("info", "처리 중...");
    fetch("/api/subscribers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone, token: token }),
    })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, json: j }; }); })
      .then(function (r) {
        if (r.ok && r.json && r.json.ok) {
          setStatus("success", "수신거부가 완료되었습니다. 앞으로 분양 시작 알림을 보내드리지 않습니다.");
          btn.style.display = "none";
        } else {
          var msg = (r.json && r.json.error) || "수신거부 처리에 실패했습니다.";
          setStatus("error", msg + " 링크가 만료되었거나 올바르지 않을 수 있습니다.");
          btn.disabled = false;
        }
      })
      .catch(function () {
        setStatus("error", "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
        btn.disabled = false;
      });
  });
})();
