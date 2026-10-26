FROM nginx:1.28-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/index.html web/app.mjs web/model.mjs web/style.css /usr/share/nginx/html/web/
COPY fvtt/scripts /usr/share/nginx/html/fvtt/scripts
COPY fvtt/compendiums /usr/share/nginx/html/fvtt/compendiums
COPY fvtt/assets /usr/share/nginx/html/fvtt/assets
EXPOSE 80
