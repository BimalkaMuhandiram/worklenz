import express from "express";

import SmartchatController from "../../controllers/smart-chat/smart-chat-controller";
import safeControllerFunction from "../../shared/safe-controller-function";

const smartChatApiRouter = express.Router();

// smartChatApiRouter.post("/", SmartchatController.create);
smartChatApiRouter.post("/chat", SmartchatController.getChatInfo);
// smartChatApiRouter.get("/", SmartchatController.get);
// smartChatApiRouter.get("/:id", SmartchatController.getById);
// smartChatApiRouter.put("/:id", SmartchatController.update);
// smartChatApiRouter.delete("/:id", SmartchatController.deleteById);

export default smartChatApiRouter;