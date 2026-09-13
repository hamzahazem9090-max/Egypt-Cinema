#!/bin/sh
# يولّد ملف htpasswd لحماية /admin/ من متغيرات البيئة ADMIN_USER / ADMIN_PASS
set -e

FILE=/etc/nginx/htpasswd
rm -f "$FILE"

USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-}"

if [ -z "$PASS" ]; then
  PASS="$(openssl rand -base64 18 | tr '/+' '_-')"
  echo "WARNING: ADMIN_PASS غير مضبوط — كلمة مرور مؤقتة للادمن: $PASS (انقلها حالاً إلى قائمة السرية في Railway)" >&2
fi

htpasswd -nb "$USER" "$PASS" > "$FILE"
chmod 644 "$FILE"
echo "htpasswd جاهز للمستخدم: $USER"