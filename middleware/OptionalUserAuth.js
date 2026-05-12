import jwt from "jsonwebtoken";

export const OptionalUserAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECET);
        req.user = {
          _id: decoded._id,
          name: decoded.name,
          email: decoded.email,
          role: decoded.role
        };
      } catch (err) {
        // If token is invalid, we just don't attach the user
        // and let the request proceed as guest
      }
    }
    next();
  } catch (error) {
    next();
  }
};
