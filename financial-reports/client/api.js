'use strict';
// שכבת גישה ל-API
const API = {
  async req(method, path, body, isForm) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body != null) {
      if (isForm) { opts.body = body; }
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    const res = await fetch('/api' + path, opts);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'שגיאה'), { status: res.status, data });
      return data;
    }
    if (!res.ok) throw Object.assign(new Error('שגיאה'), { status: res.status });
    return res;
  },
  get(p) { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b); },
  put(p, b) { return this.req('PUT', p, b); },
  patch(p, b) { return this.req('PATCH', p, b); },
  del(p) { return this.req('DELETE', p); },
  postForm(p, form) { return this.req('POST', p, form, true); },
};
window.API = API;
