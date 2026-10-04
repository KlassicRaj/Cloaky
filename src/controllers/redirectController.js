const {
    addFullscreenPromptParameter,
    validateDestinationUrl,
} = require("../validation/urlValidation");

function clientInfoFromRequest(req) {
    const acceptLanguage = req.get("Accept-Language");
    const language = typeof acceptLanguage === "string"
        ? acceptLanguage.split(",", 1)[0].split(";", 1)[0].trim()
        : "";

    return language ? { language } : {};
}

function createRedirectController({ evaluationService }) {
    return async function redirectController(req, res, next) {
        res.setHeader("Cache-Control", "no-store");

        try {
            const decision = await evaluationService.evaluate({
                projectKey: req.params.projectKey,
                request: req,
                clientInfo: clientInfoFromRequest(req),
            });

            if (decision?.reason === "project_not_found") {
                return res.status(404).json({ error: "project_not_found" });
            }

            if (decision?.reason === "project_disabled") {
                return res.status(404).json({ error: "project_disabled" });
            }

            if (decision?.matched === true && decision.action === "redirect") {
                const destination = validateDestinationUrl(decision.destinationUrl);
                if (destination.success) {
                    const location = decision.fullscreenMode === "prompt"
                        ? addFullscreenPromptParameter(destination.data).data
                        : destination.data;
                    return res.status(302).setHeader("Location", location).end();
                }
            }

            return res.status(204).end();
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = { createRedirectController };