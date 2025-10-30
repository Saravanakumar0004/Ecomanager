import axios from 'axios';

// Remove trailing slash and ensure /api is added
const getBaseURL = () => {
  const envURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  // Remove trailing slash if present
  const cleanURL = envURL.replace(/\/$/, '');
  // Add /api if not already present
  return cleanURL.endsWith('/api') ? cleanURL : `${cleanURL}/api`;
};

const BASE_URL = getBaseURL();

console.log('API Base URL:', BASE_URL); // Debug log

// Create axios instance
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000, // Increased timeout for serverless cold starts
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for CORS
});

// Request interceptor to add JWT auth token if present
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage (set after login)
    const token = localStorage.getItem('token');
    if (token) {
      // Axios v1+: config.headers may be undefined, so ensure it exists
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    console.log('Request:', config.method?.toUpperCase(), config.url); // Debug log
    return config;
  },
  (error) => {
    console.error('Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh on 401 errors
api.interceptors.response.use(
  (response) => {
    console.log('Response:', response.status, response.config.url); // Debug log
    return response;
  },
  async (error) => {
    console.error('Response Error:', {
      status: error.response?.status,
      url: error.config?.url,
      message: error.message,
      data: error.response?.data
    });

    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const response = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
          const { accessToken } = response.data.data;
          localStorage.setItem('token', accessToken);
          // Ensure headers exist and set new token for retry
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers['Authorization'] = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed, clear tokens and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default api;