const register = (req, res) => {
  res.json({ message: "Register endpoint" });
};

const login = (req, res) => {
  res.json({ message: "Login endpoint" });
};

const getCurrentUser = (req, res) => {
  res.json({ message: "Current user endpoint" });
};

const logout = (req, res) => {
  res.json({ message: "Logout endpoint" });
};

module.exports = {
  register,
  login,
  getCurrentUser,
  logout,
};