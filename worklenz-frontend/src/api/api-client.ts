import axios, { AxiosError, AxiosRequestConfig } from 'axios';

import alertService from '@/services/alerts/alertService';
import logger from '@/utils/errorLogger';

export const getCsrfToken = (): string | null => {
  const match = document.cookie.split('; ').find(cookie => cookie.startsWith('XSRF-TOKEN='));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1]);
};

// Function to refresh CSRF token by hitting the refresh endpoint
export const refreshCsrfToken = async (): Promise<string | null> => {
  try {
    // Request to refresh CSRF token cookie from server
    await axios.get(`${import.meta.env.VITE_API_URL}/csrf-token`, { withCredentials: true });
    // After this, the cookie should be updated by server, read it again
    return getCsrfToken();
  } catch (error) {
    console.error('Failed to refresh CSRF token:', error);
    return null;
  }
};

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// Add CSRF token header before every request
apiClient.interceptors.request.use(
  (config) => {
    const token = getCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    } else {
      console.warn('No CSRF token found');
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor with handling for 302 redirect and alerts
apiClient.interceptors.response.use(
  (response) => {
    if (response.status === 302) {
      const redirectUrl = response.headers.location;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return response;
      }
    }

    if (response.data) {
      const { title, message, auth_error, done } = response.data;

      if (message && message.charAt(0) !== '$') {
        if (done) {
          alertService.success(title || '', message);
        } else {
          alertService.error(title || '', message);
        }
      } else if (auth_error) {
        alertService.error(title || 'Authentication Error', auth_error);
      }
    }

    return response;
  },
  async (error: AxiosError) => {
    const errorResponse = error.response;
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Handle invalid CSRF token - retry once after refreshing token
    if (
      errorResponse?.status === 403 &&
      !originalRequest._retry &&
      (
        (typeof errorResponse.data === 'object' &&
          errorResponse.data !== null &&
          'message' in errorResponse.data &&
          errorResponse.data.message === 'Invalid CSRF token') ||
        (error as any).code === 'EBADCSRFTOKEN'
      )
    ) {
      originalRequest._retry = true;
      alertService.error('Security Error', 'Invalid security token. Refreshing your session...');

      const newToken = await refreshCsrfToken();

      if (newToken) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers['X-CSRF-Token'] = newToken;
        originalRequest.withCredentials = true;
        return axios(originalRequest);
      } else {
        // Token refresh failed, force logout
        window.location.href = '/auth/login';
        return Promise.reject(error);
      }
    }

    // Handle 401 unauthorized - force logout
    if (errorResponse?.status === 401) {
      alertService.error('Session Expired', 'Please log in again');
      window.location.href = '/auth/login';
      return Promise.reject(error);
    }

    // Show other errors except network errors
    const errorMessage = error.message || 'An unexpected error occurred';
    const errorTitle = 'Error';

    if (error.code !== 'ERR_NETWORK') {
      alertService.error(errorTitle, errorMessage);
    }

    // Log error in development environment
    if (import.meta.env.VITE_APP_ENV === 'development') {
      logger.error('API Error:', {
        code: error.code,
        name: error.name,
        message: error.message,
        headers: error.config?.headers,
        cookies: document.cookie,
      });
    }

    return Promise.reject(error);
  }
);

export default apiClient;
