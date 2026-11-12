import axios from 'axios';
const api=axios.create({baseURL:import.meta.env.VITE_API_BASE_URL||'http://192.168.8.33:5000/api'});
api.interceptors.request.use(c=>{const t=sessionStorage.getItem('foodtrace_token');if(t)c.headers.Authorization=`Bearer ${t}`;return c;});
api.interceptors.response.use(r=>r,e=>{if(e.response?.status===401){sessionStorage.removeItem('foodtrace_token');sessionStorage.removeItem('foodtrace_user');}return Promise.reject(e);});
export default api;
