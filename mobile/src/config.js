// EXPO_PUBLIC_* variables are inlined at build time, so a local backend can be used with
//   EXPO_PUBLIC_BACKEND_URL=http://192.168.x.x:3000 npx expo start
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://rallypair.onrender.com';
export const OSRM_URL = process.env.EXPO_PUBLIC_OSRM_URL || 'https://router.project-osrm.org';
