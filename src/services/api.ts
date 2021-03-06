/* eslint-disable import/no-cycle */
import axios, { AxiosError } from 'axios';
import { parseCookies, setCookie } from 'nookies';

import { signOut } from '@contexts/AuthContext';
import CoockiesEnum from '@enums/CoockiesEnum';
import { AuthTokenError } from './error/AuthTokenError';

let isRefreshing = false;
let failedRequestQueue = [];

export function setupAPIClient(ctx = undefined) {
  let coockies = parseCookies(ctx);

  const api = axios.create({
    baseURL: 'http://localhost:3333',
    headers: {
      Authorization: `Bearer ${coockies[CoockiesEnum.TOKEN]}`,
    },
  });

  api.interceptors.response.use(
    response => {
      return response;
    },
    (error: AxiosError) => {
      if (error.response.status === 401) {
        if (error.response.data?.code === 'token.expired') {
          coockies = parseCookies();

          const { [CoockiesEnum.REFRESH_TOKEN]: refreshToken } = coockies;
          const originalConfig = error.config;

          if (!isRefreshing) {
            isRefreshing = true;

            api
              .post('/refresh', {
                refreshToken,
              })
              .then(response => {
                const { token } = response.data;

                setCookie(ctx, CoockiesEnum.TOKEN, token, {
                  maxAge: 60 * 60 * 24 * 30, // 30 days
                  path: '/',
                });

                setCookie(
                  ctx,
                  CoockiesEnum.REFRESH_TOKEN,
                  response.data.refreshToken,
                  {
                    maxAge: 60 * 60 * 24 * 30, // 30 days
                    path: '/',
                  },
                );

                api.defaults.headers.common.Authorization = `Bearer ${token}`;

                failedRequestQueue.forEach(request => request.onSuccess(token));

                failedRequestQueue = [];
              })
              .catch(err => {
                failedRequestQueue.forEach(request => request.onFailure(err));
                failedRequestQueue = [];

                if (process.browser) {
                  signOut();
                }
              })
              .finally(() => {
                isRefreshing = false;
              });
          }

          return new Promise((resolve, reject) => {
            failedRequestQueue.push({
              onSuccess: (token: string) => {
                originalConfig.headers.Authorization = `Bearer ${token}`;

                resolve(api(originalConfig));
              },
              onFailure: (error: AxiosError) => {
                reject(error);
              },
            });
          });
        }
        if (process.browser) {
          signOut();
        } else {
          return Promise.reject(new AuthTokenError());
        }
      }

      return Promise.reject(error);
    },
  );

  return api;
}
