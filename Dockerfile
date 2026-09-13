FROM nginx:alpine
ENV PORT=8080

RUN apk add --no-cache apache2-utils

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.d/40-htpasswd.sh /docker-entrypoint.d/40-htpasswd.sh
RUN chmod +x /docker-entrypoint.d/40-htpasswd.sh

COPY index.html style.css app.js /usr/share/nginx/html/
COPY admin/index.html admin/app.js /usr/share/nginx/html/admin/