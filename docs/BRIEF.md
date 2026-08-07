You are a senior full-stack architect and security engineer. Design and generate a complete production-ready architecture and implementation plan for a highly secure, scalable, offline-first application that supports Web, Android, and iOS from a single codebase.

Project requirements:

1. Existing frontend:
- The current application is built with HTML, CSS, and JavaScript.
- Reuse as much of the existing codebase as possible.
- Use a single codebase for web, Android, and iOS.
- Minimize maintenance effort.

2. Frontend technology:
- Use Ionic + Capacitor.
- Follow a modular architecture.
- Implement proper state management.
- Recommend the best state-management library.
- Support dark mode and responsive design.
- Optimize for performance and low-end devices.

3. Offline-first functionality:
- The application must work without internet access.
- Any data entered by users must immediately be saved locally.
- Use SQLite on mobile devices and IndexedDB on the web.
- Every record must contain:
    - local_id
    - server_id
    - created_at
    - updated_at
    - sync_status (pending, synced, failed)
    - version number
- Build a synchronization engine that:
    - detects internet availability
    - automatically syncs pending records
    - retries failed uploads
    - resolves conflicts
    - prevents duplicate records
- Explain conflict resolution strategies.

4. Backend:
- Deploy on DigitalOcean.
- Use Docker containers.
- Use Ubuntu LTS.
- Use Nginx as a reverse proxy.
- Use Node.js with NestJS or Express.
- Use Redis for caching and queues.
- Expose APIs through api.domain.com.

5. Database:
- Use PostgreSQL.
- Design database schemas for:
    - users
    - roles
    - sessions
    - notifications
    - audit logs
    - application data
    - sync metadata
- Add indexing and optimization strategies.
- Explain partitioning and scaling.

6. File storage:
- Use DigitalOcean Spaces.
- Store:
    - profile images
    - documents
    - uploads
    - backups
- Never store files inside PostgreSQL.

7. Security (highest priority):
- Assume the system stores highly sensitive information.
- Follow OWASP best practices.
- Implement:
    - JWT authentication
    - refresh tokens
    - role-based access control
    - permissions system
    - Argon2 password hashing
    - email verification
    - two-factor authentication
    - encrypted database fields
    - API validation
    - SQL injection prevention
    - XSS protection
    - CSRF protection
    - rate limiting
    - bot detection
    - account lockout
    - suspicious login detection
    - audit logs
    - session management
    - secure cookies
    - API key management
    - encryption in transit
    - encryption at rest
    - secrets management

8. Cloudflare:
- Use Cloudflare DNS.
- Configure:
    - SSL Full Strict
    - DDoS protection
    - WAF
    - bot protection
    - caching
    - firewall rules
    - rate limiting
    - security headers

9. DevOps:
- Use GitHub.
- Create:
    - development environment
    - staging environment
    - production environment
- Build CI/CD pipelines using GitHub Actions.
- Use zero-downtime deployment.
- Explain rollback strategies.

10. Monitoring:
- Add:
    - logs
    - alerts
    - uptime monitoring
    - error tracking
    - server metrics
    - database metrics
    - security alerts

11. Scalability:
- Design for:
    - 10,000+ users initially
    - future scaling to 100,000+ users
- Explain:
    - load balancing
    - database replication
    - caching
    - horizontal scaling
    - CDN strategy

12. Deliverables:
- Full folder structure
- Database schema
- API design
- Authentication flow
- Offline synchronization flow
- Deployment diagram
- Security checklist
- Infrastructure diagram
- Docker configuration
- CI/CD workflow
- Backup and recovery plan
- Cost estimates for DigitalOcean

Prioritize security first, then performance, then usability, then developer experience. Explain every design choice and justify why it was selected.