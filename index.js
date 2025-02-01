// Content script (index.js)
const channel = new BroadcastChannel("todo_updates");
const todoListElement = document.getElementById("todo-list");

// App state management - keep this global but treat highlight as local
const appState = {
  editingId: null,
  inputValue: '',
};

// Local UI state - specific to this tab
const localState = {
  highlightedId: null
};

function loadTodos() {
  chrome.storage.local.get("todos", (data) => {
    const todos = data.todos || [];
    renderTodos(todos);
  });
}

function saveTodos(todos) {
  chrome.storage.local.set({ todos });
}

function renderTodos(todos) {
  todoListElement.innerHTML = "";
  
  // Create active and completed lists
  const activeList = document.createElement("ul");
  activeList.id = "active-todos";
  const completedList = document.createElement("ul");
  completedList.id = "completed-todos";
  
  // Add input field and button for new todos
  const newTodoForm = document.createElement("div");
  newTodoForm.innerHTML = `
    <input type="text" id="new-todo-input" placeholder="Add a new todo">
    <button id="add-todo-btn">Add</button>
  `;
  todoListElement.appendChild(newTodoForm);
  todoListElement.appendChild(activeList);
  todoListElement.appendChild(completedList);

  // Restore input value from app state
  const input = document.getElementById("new-todo-input");
  input.value = appState.inputValue;
  input.addEventListener('input', (e) => {
    appState.inputValue = e.target.value;
  });

  // Function to handle adding new todo
  const addNewTodo = () => {
    const text = appState.inputValue.trim();
    if (text) {
      todos.unshift({ text, done: false });
      saveTodos(todos);
      appState.inputValue = '';
      input.value = '';
      renderTodos(todos);
    }
  };

  // Add event listeners for new todo creation
  document.getElementById("add-todo-btn").addEventListener("click", addNewTodo);
  document.getElementById("new-todo-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNewTodo();
    }
  });

  // Separate todos into active and completed
  const activeTodos = todos.filter(todo => !todo.done);
  const completedTodos = todos.filter(todo => todo.done);

  // Render both lists
  [
    { items: activeTodos, container: activeList },
    { items: completedTodos, container: completedList }
  ].forEach(({ items, container }) => {
    items.forEach((todo, listIndex) => {
      const index = todos.indexOf(todo);
      const li = document.createElement("li");
      li.innerHTML = `<input type="checkbox" ${todo.done ? "checked" : ""}> 
                      <span contenteditable>${todo.text}</span>`;
      li.setAttribute('tabindex', '0');
      li.dataset.index = index;
      
      // Add drag and drop attributes
      li.draggable = true;
      li.classList.add('draggable');

      // Apply highlight from local state only
      if (index === localState.highlightedId) {
        li.classList.add('todo-highlight');
        if (appState.editingId === index) {
          const span = li.querySelector('span');
          requestAnimationFrame(() => {
            span.focus();
            // Place cursor at the end
            const range = document.createRange();
            range.selectNodeContents(span);
            range.collapse(false);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          });
        }
      }

      // Update local state on focus/blur
      li.addEventListener('focus', () => {
        localState.highlightedId = index;
        li.classList.add('todo-highlight');
        // Notify other tabs to clear their highlights
        channel.postMessage({ 
          type: 'clearHighlight'
        });
      });
      
      li.addEventListener('blur', (e) => {
        if (!li.contains(e.relatedTarget)) {
          localState.highlightedId = null;
          li.classList.remove('todo-highlight');
        }
      });

      const span = li.querySelector("span");
      
      span.addEventListener('focus', () => {
        localState.highlightedId = index;
        appState.editingId = index;
        li.classList.add('todo-highlight');
        // Notify other tabs to clear their highlights
        channel.postMessage({ 
          type: 'clearHighlight'
        });
      });

      span.addEventListener('blur', () => {
        appState.editingId = null;
      });

      // Handle Enter in edit mode
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          todos[index].text = span.textContent;
          saveTodos(todos);
          channel.postMessage({ 
            type: 'update',
            appState: {
              editingId: appState.editingId,
              inputValue: appState.inputValue
            }
          });
        }
      });

      li.querySelector("input").addEventListener("change", () => {
        todos[index].done = !todos[index].done;
        saveTodos(todos);
        renderTodos(todos);
      });
      
      container.appendChild(li);
    });
  });
}

// Update channel listener to handle different message types
channel.addEventListener("message", (event) => {
  if (event.data.type === 'clearHighlight') {
    // Clear local highlight when another tab sets a highlight
    localState.highlightedId = null;
    document.querySelectorAll('.todo-highlight').forEach(el => {
      el.classList.remove('todo-highlight');
    });
  } else if (event.data.type === 'update') {
    if (event.data.appState) {
      Object.assign(appState, event.data.appState);
    }
    loadTodos();
  }
});

// Clear highlight when tab/window loses focus
window.addEventListener('blur', () => {
  localState.highlightedId = null;
  document.querySelectorAll('.todo-highlight').forEach(el => {
    el.classList.remove('todo-highlight');
  });
});

document.addEventListener("DOMContentLoaded", loadTodos);

// Drag-and-drop reordering
todoListElement.addEventListener('dragstart', (e) => {
  if (e.target.tagName === 'LI') {
    e.target.classList.add('dragging');
  }
});

todoListElement.addEventListener('dragover', (e) => {
  e.preventDefault();
  const draggingItem = todoListElement.querySelector('.dragging');
  if (!draggingItem) return;
  
  const targetList = e.target.closest('ul');
  if (!targetList) return;

  const siblings = [...targetList.querySelectorAll('li:not(.dragging)')];
  
  const nextSibling = siblings.find(sibling => {
    const rect = sibling.getBoundingClientRect();
    const midPoint = rect.top + rect.height / 2;
    return e.clientY < midPoint;
  });

  if (nextSibling) {
    targetList.insertBefore(draggingItem, nextSibling);
  } else {
    targetList.appendChild(draggingItem);
  }
});

todoListElement.addEventListener('dragend', (e) => {
  if (e.target.tagName !== 'LI') return;
  
  e.target.classList.remove('dragging');
  const activeTodos = Array.from(document.querySelector('#active-todos').querySelectorAll('li')).map(li => ({
    text: li.querySelector('span').textContent,
    done: false
  }));
  
  const completedTodos = Array.from(document.querySelector('#completed-todos').querySelectorAll('li')).map(li => ({
    text: li.querySelector('span').textContent,
    done: true
  }));
  
  const newTodos = [...activeTodos, ...completedTodos];
  saveTodos(newTodos);
  channel.postMessage({ type: 'update' });
});

// Update keyboard navigation
document.addEventListener('keydown', (e) => {
  const focused = document.activeElement;
  const allLists = [
    ...document.querySelector('#active-todos').querySelectorAll('li'),
    ...document.querySelector('#completed-todos').querySelectorAll('li')
  ];
  const currentIndex = allLists.indexOf(focused.tagName === 'SPAN' ? focused.parentElement : focused);
  
  if (focused.tagName === 'SPAN' && e.key === 'Enter') {
    console.log('Enter pressed in span');
    e.preventDefault();
    chrome.storage.local.get("todos", (data) => {
      const todos = data.todos || [];
      const index = parseInt(focused.parentElement.dataset.index);
      todos[index].text = focused.textContent;
      saveTodos(todos);
      channel.postMessage({ type: 'update' });
      // Add highlight to parent li
      const parentLi = focused.parentElement;
      localState.highlightedId = parseInt(parentLi.dataset.index);
      parentLi.classList.add('todo-highlight');
      // Place cursor at the end
      const range = document.createRange();
      range.selectNodeContents(focused);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    return;
  }
  
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentIndex > 0) {
        // Clear old highlight
        document.querySelectorAll('.todo-highlight').forEach(el => {
          el.classList.remove('todo-highlight');
        });
        // Set new highlight
        allLists[currentIndex - 1].classList.add('todo-highlight');
        localState.highlightedId = parseInt(allLists[currentIndex - 1].dataset.index);
        allLists[currentIndex - 1].focus();
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (currentIndex < allLists.length - 1) {
        // Clear old highlight
        document.querySelectorAll('.todo-highlight').forEach(el => {
          el.classList.remove('todo-highlight');
        });
        // Set new highlight
        allLists[currentIndex + 1].classList.add('todo-highlight');
        localState.highlightedId = parseInt(allLists[currentIndex + 1].dataset.index);
        allLists[currentIndex + 1].focus();
      }
      break;
    case 'e':
      if (focused.tagName === 'LI') {
        e.preventDefault();
        const span = focused.querySelector('span');
        localState.highlightedId = parseInt(focused.dataset.index);
        focused.classList.add('todo-highlight');
        span.focus();
        // Place cursor at the end
        const range = document.createRange();
        range.selectNodeContents(span);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      break;
  }
});