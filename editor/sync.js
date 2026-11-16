/* Same-origin authenticated session synchronization. */
(function(w){'use strict';
 async function token(){if(!w.SahmSupabase||typeof w.SahmSupabase.session!=='function')throw new Error('تعذر قراءة جلسة الحساب.');var s=await w.SahmSupabase.session();if(!s||!s.access_token)throw new Error('سجّل الدخول بحساب مخول لحفظ جلسات التحرير.');return s.access_token;}
 async function request(url,options){var access=await token();var r=await fetch(url,Object.assign({credentials:'same-origin',headers:Object.assign({Authorization:'Bearer '+access,Accept:'application/json'},options&&options.headers||{})},options||{}));var j={};try{j=await r.json();}catch(_){}if(!r.ok)throw new Error(j.error||'تعذر حفظ الجلسة ('+r.status+').');return j;}
 async function status(){var r=await fetch('/api/editor/status',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw new Error('EDITOR_API_UNAVAILABLE');return r.json();}
 function save(s){return request('/api/editor/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});}
 function list(){return request('/api/editor/sessions',{method:'GET'});}
 w.SahmEditorSync={status:status,save:save,list:list};
})(window);