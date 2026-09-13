FROM nginx:alpine
ENV PORT=8080

RUN apk add --no-cache apache2-utils

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY 40-htpasswd.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/40-htpasswd.sh

COPY index.html style.css app.js dashboard.html dashboard.js /usr/share/nginx/html/