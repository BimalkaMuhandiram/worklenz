import Cookies from 'js-cookie';

export function getCsrfToken(): string | undefined {
  return Cookies.get('XSRF-TOKEN');
}
