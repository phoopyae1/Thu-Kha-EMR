import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// MCP configuration mapping
const MCP_CONFIGS: Record<string, string> = {
  appointments: 'appointments.mcp.json',
  // Add more MCP configurations here as needed
  // pharmacy: 'pharmacy.mcp.json',
  // billing: 'billing.mcp.json',
};

/**
 * Load MCP configuration file
 */
function loadMCPConfig(slug: string): any {
  const configFile = MCP_CONFIGS[slug];
  if (!configFile) {
    return null;
  }

  try {
    const mcpFilePath = join(__dirname, configFile);
    const fileContent = readFileSync(mcpFilePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to load MCP configuration for slug: ${slug}`);
  }
}

/**
 * Health check endpoint - matches the reference pattern
 * GET /api/mcp/:slug
 */
router.get('/:slug', (req: Request, res: Response) => {
  const { slug } = req.params;
  
  res.json({
    ok: true,
    slug: slug,
    message: 'MCP endpoint is running'
  });
});

/**
 * Get MCP tools configuration
 * GET /api/mcp/:slug/tools
 */
router.get('/:slug/tools', (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const mcpData = loadMCPConfig(slug);
    
    if (!mcpData) {
      return res.status(404).json({
        ok: false,
        slug: slug,
        error: 'MCP configuration not found for this slug',
        availableSlugs: Object.keys(MCP_CONFIGS)
      });
    }
    
    res.json({
      ok: true,
      slug: slug,
      ...mcpData
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      slug: req.params.slug,
      error: 'Failed to load MCP tools',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
