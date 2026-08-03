// lazy load CDN libraries only when needed
function loadJS(u){return new Promise((o,n)=>{let s=document.createElement('script');s.src=u;s.onload=o;s.onerror=n;document.head.appendChild(s)})}
let _m=0,_c=0;
async function needM(){if(!_m&&typeof marked==='undefined'){await loadJS('https://cdn.jsdelivr.net/npm/marked@11/marked.min.js');_m=1}}
async function needC(){if(!_c&&typeof Chart==='undefined'){await loadJS('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');_c=1}}
