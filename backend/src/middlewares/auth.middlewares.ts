import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
    id: string;
    email: string;
    roles: string[];
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

//Check the authentication
export function authenticate(req: Request,res: Response,next: NextFunction) {

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication token required',
        });
    }

    const token = authHeader.slice('Bearer '.length);
    const secret = process.env.JWT_SECRET ?? 'student-org-demo-secret';

    if (!secret) {
        console.error('JWT_SECRET is not configured');

        return res.status(500).json({
            success: false,
            message: 'Server configuration error',
        });
    }

    try {
        const decoded = jwt.verify(token, secret);

        if (typeof decoded === 'string' ||!decoded.sub ||typeof decoded.email !== 'string' 
            ||!Array.isArray(decoded.roles) ||!decoded.roles.every((role) => typeof role === 'string')) {
                
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token',
            });
        }

        req.user = {
            id: decoded.sub,
            email: decoded.email,
            roles: decoded.roles,
        };

        return next();
    } 
    catch {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired authentication token',
        });
    }
}

export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();
    try {
        const decoded = jwt.verify(authHeader.slice('Bearer '.length), process.env.JWT_SECRET ?? 'student-org-demo-secret');
        if (typeof decoded !== 'string' && decoded.sub && typeof decoded.email === 'string' && Array.isArray(decoded.roles)) {
            req.user = { id: decoded.sub, email: decoded.email, roles: decoded.roles.filter((role): role is string => typeof role === 'string') };
        }
    } catch {
        // Public event details remain available when an expired token is present.
    }
    return next();
}

// Check the user roles authorization
export function authorize(...allowedRoles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
        }

        if (!req.user.roles.some((role) => allowedRoles.includes(role))) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to perform this action',
            });
        }

        return next();
    };
}
