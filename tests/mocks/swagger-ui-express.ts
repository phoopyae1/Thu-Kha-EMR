const serve = (_req: unknown, _res: unknown, next: () => void) => {
  next();
};

const setup = () => (_req: unknown, _res: unknown, next: () => void) => {
  next();
};

export { serve, setup };

export default { serve, setup };
