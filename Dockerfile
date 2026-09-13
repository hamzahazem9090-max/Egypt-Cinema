FROM nginx:alpine
ENV PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html style.css app.js /usr/share/nginx/html/