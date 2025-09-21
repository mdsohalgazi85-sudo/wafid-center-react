chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Check if the message type is 'trigger-automation-in-new-tab'
  if (msg?.type === "trigger-automation-in-new-tab") {
    const receiverTabUrl: string = msg.receiverTabUrl; // URL of the receiver tab (e.g., 'wafid.com')

    // Open the new tab with the receiver URL
    chrome.tabs.create({ url: receiverTabUrl }, (newTab) => {
      // Once the new tab is opened, inject the script to trigger automation
      chrome.scripting.executeScript({
        target: { tabId: newTab.id! },
        func: triggerAutomationInReceiverTab,
        args: [msg.row], // Passing row data to the receiver tab
      }, (injectedResult) => {
        // Check for errors when executing the script
        if (chrome.runtime.lastError) {
          console.error("Error in executing script: ", chrome.runtime.lastError);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          console.log("Script executed successfully", injectedResult);
          sendResponse({ ok: true });
        }
      });
    });

    return true;  // Keep the message channel open for async response
  }

  // Ensure response is sent in case no action is performed
  return true; 
});

// Function to trigger automation in the receiver tab
function triggerAutomationInReceiverTab(row: { name: string; email: string; phone: string; nationalId: string; passport: string; city: string; country: string; appointmentDate: string; }) {
  console.log("Receiver tab automation triggered with data:", row);

  try {
    // Example: Filling out form fields with values from row object
    if (row.name) {
      const nameInput = document.querySelector("input[name='name']") as HTMLInputElement;
      if (nameInput) nameInput.value = row.name;
    }

    if (row.email) {
      const emailInput = document.querySelector("input[name='email']") as HTMLInputElement;
      if (emailInput) emailInput.value = row.email;
    }

    // More fields...

    // Example: Trigger form submission by clicking the submit button
    const submitButton = document.querySelector("button[type='submit']") as HTMLButtonElement;
    if (submitButton) {
      submitButton.click();
    }

    console.log("Form filled and automation triggered successfully.");
  } catch (error) {
    console.error("Error in triggering automation:", error);
  }
}
