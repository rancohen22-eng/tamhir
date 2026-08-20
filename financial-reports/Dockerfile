# מערכת דוחות כספיים · ארקיע — קונטיינר הרצה
FROM node:20-slim

WORKDIR /app

# תלויות (שכבה נפרדת ל-cache יעיל)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# קוד המקור
COPY . .

# הרשאות הרצה ל-entrypoint + משתמש לא-root
RUN chmod +x /app/docker-entrypoint.sh && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

# entrypoint מריץ migrations + seed ואז מפעיל את השרת
ENTRYPOINT ["/app/docker-entrypoint.sh"]
